package main

import (
	"encoding/json"
	"log"
	"net/url"
	"os"
	"strings"

	"golang.org/x/net/html"

	"github.com/PuerkitoBio/goquery"
	"github.com/hoisie/redis"
	"github.com/streamrail/concurrent-map"
	"github.com/valyala/fasthttp"
)

var r redis.Client

func main() {
	urlp, _ := url.Parse(os.Getenv("REDIS_URL"))
	password, _ := urlp.User.Password()
	r = redis.Client{
		Addr:     urlp.Host,
		Password: password,
	}

	port := os.Getenv("PORT")
	log.Print("running at port " + port)
	fasthttp.ListenAndServe(":"+port, handler)
}

func handler(ctx *fasthttp.RequestCtx) {
	switch string(ctx.Path()) {
	case "/":
		fasthttp.ServeFile(ctx, "index.html")
	case "/bundle.js", "/styles.css":
		fasthttp.ServeFile(ctx, string(ctx.Path())[1:])
	case "/search":
		query := ctx.QueryArgs().Peek("q")
		data := fetchDataForQuery(string(query))
		ctx.SetContentType("application/json")
		ctx.Response.Header.Set("Access-Control-Allow-Origin", "*")
		ctx.SetBody(data)
	default:
		ctx.SetStatusCode(404)
	}
}

func fetchDataForQuery(search string) []byte {
	cacheKey := "query:" + search
	if resp, err := r.Get(cacheKey); err == nil && len(resp) > 0 {
		// CACHE HIT
		return resp
	}

	query := (url.Values{
		"q":     []string{search},
		"limit": []string{"300"},
	}).Encode()
	doc, err := docFromISO8859("https://www.estantevirtual.com.br/busca?" + query)
	if err != nil {
		log.Print(err)
	}

	sel := doc.Find(`[itemtype="http://schema.org/Book"]`)
	sem := make(chan bool, len(sel.Nodes))
	cstores := cmap.New()

	for _, node := range sel.Nodes {
		go func(n *html.Node) {
			s := goquery.NewDocumentFromNode(n)

			if bookUrl, ok := s.Attr("href"); ok {
				bookDoc, err := docFromISO8859("https://www.estantevirtual.com.br" + bookUrl)
				if err != nil {
					return
				}

				bookDoc.Find(".busca-box").Each(func(_ int, l *goquery.Selection) {
					url, _ := l.Find(".busca-seller").Attr("href")
					var st Store
					ist, ok := cstores.Get(url)
					if !ok {
						st = Store{
							Name:  l.Find(".busca-seller").Text(),
							Place: strings.TrimSpace(l.Find(".busca-address").Text()),
							URL:   url,
						}
					} else {
						st = ist.(Store)
					}

					bookUrl, _ = l.Find("a").Attr("href")

					st.Books = append(st.Books, Book{
						Title:  s.Find(".busca-title").Text(),
						Author: s.Find(".busca-author").Text(),
						Offers: []BookOffer{
							BookOffer{
								Price: l.Find(".busca-price-currency + span").Text(),
								URL:   bookUrl,
							},
						},
					})
					cstores.Set(url, st)
				})
			}

			sem <- true
		}(node)
	}

	for i := 0; i < len(sel.Nodes); i++ {
		<-sem
	}

	// turning the concurrent map into a map of stores
	keys := cstores.Keys()
	stores := make(map[string]Store)
	for _, k := range keys {
		ist, _ := cstores.Get(k)
		st := ist.(Store)

		// inside each store, turn occurrences of the same book into one
		condensedbooks := make(map[string]Book)
		for _, book := range st.Books {
			var cbook Book
			var ok bool
			if cbook, ok = condensedbooks[book.Title]; !ok {
				cbook = Book{
					Title:  book.Title,
					Author: book.Author,
				}
			}
			cbook.Offers = append(cbook.Offers, book.Offers[0])
			condensedbooks[cbook.Title] = cbook
		}
		st.Books = make([]Book, len(condensedbooks))
		var j int
		for _, b := range condensedbooks {
			st.Books[j] = b
			j++
		}

		stores[st.URL] = st
	}

	data, err := json.Marshal(stores)
	if err != nil {
		log.Print(err)
	}

	// CACHE SAVE
	if err := r.Setex(cacheKey, 60*60*6 /* 6 hours */, data); err != nil {
		log.Print(err)
	}

	return data
}

type Book struct {
	Title  string      `json:"title"`
	Author string      `json:"author"`
	Offers []BookOffer `json:"offers"`
}

type BookOffer struct {
	Price string `json:"price"`
	URL   string `json:"url"`
}

type Store struct {
	Name  string `json:"name"`
	Place string `json:"place"`
	URL   string `json:"url"`
	Books []Book `json:"books"`
}
