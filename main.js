/* global bean, h, snabbdom, XMLHttpRequest, snabbdom_style, snabbdom_props, location */

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
  stores: {s1: {}, s2: {}, s3: {}, s4: {}, s5: {}},
  storecost: {},
  storemap: {}
}

function fetchResults (name, query) {
  if (query.length < 3) {
    handleResults(name, [], true)
  }

  var xhr = new XMLHttpRequest()
  xhr.open('GET', '/search?q=' + query.replace(/ /g, '+'))
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return
    handleResults(name, JSON.parse(xhr.responseText))
  }
  xhr.send()
}

function handleResults (name, results, isNull) {
  // tell user how many results we have
  var infobox = document.querySelector('input[name="' + name + '"]').nextElementSibling
  if (isNull) {
    infobox.innerHTML = ''
  } else {
    var nbooks = results.reduce(function (acc, store) {
      return acc + store.books.reduce(function (acc, book) {
        return acc + book.offers.length
      }, 0)
    }, 0)
    infobox.innerHTML = nbooks + ' livros em ' + results.length + ' sebos'
  }

  // change global state
  state.stores[name] = {}
  results.forEach(function (store) {
    state.stores[name][store.url] = store
  })

  state.storemap = {}
  for (var s in state.stores) {
    for (var url in state.stores[s]) {
      var books = state.stores[s][url].books
        .map(function (book) {
          book.s = s
          return book
        })

      if (state.storemap[url]) {
        state.storemap[url].books = state.storemap[url].books.concat(books)
      } else {
        state.storemap[url] = state.stores[s][url]
        state.storemap[url].books = books
      }
    }
  }

  renderState()
}

bean.on(document.body, 'change', 'input[type="checkbox"]', function (e) {
  var sturl = e.target.parentNode.parentNode.parentNode.parentNode.parentNode.firstChild.href
  var price = parseFloat(e.target.parentNode.title)
  var diff = e.target.checked ? +price : -price
  state.storecost[sturl] = (state.storecost[sturl] || 0) + diff
  if (state.storecost[sturl] === 0) {
    delete state.storecost[sturl]
  }

  renderState()
})

// prepare snabbdom
var patch = snabbdom.init([snabbdom_props, snabbdom_style])
var container = document.getElementById('results')
var currentvnode = document.createElement('div')
container.appendChild(currentvnode)

function renderState () {
  var storelist = Object.keys(state.storemap)
    .map(function (url) { return state.storemap[url] })
    .map(function (store) {
      store.books = store.books
        .sort(function (a, b) { return b.title > a.title ? 1 : -1 })
      return store
    })
    .sort(function (a, b) { return b.books.length - a.books.length })

  var newvnode = h('ul',
    storelist.map(function (store) {
      return h('li', {key: store.url}, [
        h('a', {props: {href: store.url, target: '_blank'}}, store.name),
        ', ',
        store.place.split(' - ').reverse().join(', '),
        state.storecost[store.url]
          ? ' | ' + state.storecost[store.url]
          : '',
        h('table',
          store.books.map(function (book) {
            return h('tr', {key: book.title + book.author, props: {className: book.s}}, [
              h('td.title', [
                h('b', book.title),
                ', ' + book.author
              ]),
              h('td.price',
                book.offers.map(function (o) {
                  return h('span', {
                    key: o.url,
                    props: {title: o.price}
                  }, [
                    h('input', {props: {type: 'checkbox'}}),
                    h('a', {props: {href: o.url, target: '_blank'}}, parseInt(o.price))
                  ])
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
// if (Math.random() > 0.2) {
//   for (var s = 1; s <= 5; s++) {
//     document.documentElement.style.setProperty('--s' + s, randomColor({luminosity: 'dark'}))
//   }
// }
