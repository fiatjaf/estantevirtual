/* global bean, h, snabbdom, XMLHttpRequest, snabbdom_style, snabbdom_props, location, randomColor */

// search on input
var wait = {}
bean.on(document.body, 'input', 'input', function (e) {
  clearTimeout(wait[e.target.name])
  wait[e.target.name] = setTimeout(function () {
    // actual search
    fetchResults(e.target.name, e.target.value)

    // show current search after input box
    e.target.nextElementSibling.innerHTML = 'procurando ' + e.target.value

    // save searched state to URL hash
    var currentSearches = location.hash.slice(1).split('|')
    currentSearches[parseInt(e.target.name[1])] = e.target.value
    location.hash = currentSearches.join('|')
  }, 2000) // only react 2 seconds after the user stops typing

  // tell user we are waiting him to type
  e.target.nextElementSibling.innerHTML = 'esperando nome'
})

// do this on beggining: perform the searches given by the URL hash
var currentSearches = location.hash.slice(1).split('|')
for (var i = 1; i <= currentSearches.length; i++) {
  if (currentSearches[i]) {
    var name = 's' + i
    document.querySelector('input[name="' + name + '"]').value = currentSearches[i]
    fetchResults(name, currentSearches[i])
  }
}

var state = {
  stores: {s1: {}, s2: {}, s3: {}, s4: {}, s5: {}}
}

function fetchResults (name, query) {
  if (query.length < 3) {
    handleResults(name, [])
  }

  var xhr = new XMLHttpRequest()
  xhr.open('GET', '/search?q=' + query.replace(/ /g, '+'))
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return
    handleResults(name, JSON.parse(xhr.responseText))
  }
  xhr.send()
}

function handleResults (name, results) {
  // tell user how many results we have
  var nbooks = results.reduce(function (acc, store) {
    return acc + store.books.reduce(function (acc, book) {
      return acc + book.offers.length
    }, 0)
  }, 0)
  var infobox = document.querySelector('input[name="' + name + '"]').nextElementSibling
  infobox.innerHTML = nbooks + ' livros em ' + results.length + ' sebos'

  // change global state
  state.stores[name] = {}
  results.forEach(function (store) {
    state.stores[name][store.url] = store
  })

  renderState()
}

var patch = snabbdom.init([snabbdom_props, snabbdom_style])
var container = document.getElementById('results')
var currentvnode = document.createElement('div')
container.appendChild(currentvnode)

function renderState () {
  var storemap = {}
  for (var s in state.stores) {
    for (var url in state.stores[s]) {
      var books = state.stores[s][url].books
        .map(function (book) {
          book.s = s
          return book
        })

      if (storemap[url]) {
        storemap[url].books = storemap[url].books.concat(books)
      } else {
        storemap[url] = state.stores[s][url]
        storemap[url].books = books
      }
    }
  }

  var storelist = Object.keys(storemap)
    .map(function (url) { return storemap[url] })
    .map(function (store) {
      store.books = store.books
        .sort(function (a, b) { return b.title > a.title ? 1 : -1 })
      return store
    })
    .sort(function (a, b) { return b.books.length - a.books.length })

  var newvnode = h('ul',
    storelist.map(function (store) {
      return h('li', [
        h('a', {props: {href: store.url, target: '_blank'}}, store.name),
        ' -- ',
        h('span', store.place),
        h('table',
          store.books.map(function (book) {
            return h('tr', {props: {className: book.s}}, [
              h('td.title', book.title + ', ' + book.author),
              h('td.price',
                book.offers.map(function (o) {
                  return h('a', {props: {href: o.url, target: '_blank'}}, parseInt(o.price))
                }).reduce(function (acc, off, i) {
                  acc.push(off)
                  if (i < book.offers.length - 1) {
                    acc.push(', ')
                  }
                  return acc
                }, [])
              )
            ])
          })
        )
      ])
    })
  )
  currentvnode = patch(currentvnode, newvnode)
}

// randomize colors (sooometimes)
if (Math.random() > 0.2) {
  for (var s = 1; s <= 5; s++) {
    document.documentElement.style.setProperty('--s' + s, randomColor({luminosity: 'dark'}))
  }
}
