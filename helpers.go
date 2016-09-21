package main

import (
	"net/http"

	"github.com/PuerkitoBio/goquery"
	"golang.org/x/text/encoding/charmap"
)

func docFromISO8859(url string) (*goquery.Document, error) {
	response, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	reader := charmap.ISO8859_10.NewDecoder().Reader(response.Body)
	return goquery.NewDocumentFromReader(reader)
}
