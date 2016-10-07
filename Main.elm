port module App exposing (..)

import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Html.Keyed as Keyed
import Html.Lazy exposing (..)
import Platform.Cmd as Cmd
import Array exposing (Array)
import Array.Extra
import Navigation exposing (Location)
import Json.Decode as J exposing ((:=))
import Dict exposing (Dict)
import String
import Http
import Task
import Debug exposing (log)


main =
    Navigation.program
        (Navigation.makeParser (\l -> l))
        { init = init
        , view = view
        , update = update
        , urlUpdate = urlUpdate
        , subscriptions = \_ -> Sub.none
        }


-- MODEL

type alias Model =
    { searches : Array Search
    , baseURL : String
    }

type alias Search =
    { query : String
    , status : Status
    }

type Status
    = Searching String
    | Found String SearchResults
    | Waiting
    | Error String

type alias SearchResults
    = Dict String Store

type alias Store =
    { books : List Book
    , name : String
    , place : String
    , url : String
    }

type alias Book =
    { offers : List Offer
    , author : String
    , title : String
    , searchIndex : Int
    }

type alias Offer =
    { price : String
    , url : String
    }

initialSearch : Search
initialSearch = Search "" Waiting

init : Location -> (Model, Cmd Msg)
init l =
    let
        searches = Array.initialize 4 <| always initialSearch
        port_ = case String.toInt l.port_ of
            Ok p -> p + 1
            Err e -> if l.protocol == "http:" then 80 else 443
        host = case (String.split ":" l.host) |> List.head of
            Nothing -> l.host
            Just h -> h
        baseURL = l.protocol ++ "//" ++ host ++ ":" ++ toString port_
    in
        (Model searches baseURL, Cmd.none)


-- UPDATE

type Msg
    = UpdateBox (Int, String)
    | SearchThis Int
    | AddBox
    | FetchSucceed Int String SearchResults
    | FetchFail Int Http.Error

update : Msg -> Model -> (Model, Cmd Msg)
update msg model =
    case msg of
        UpdateBox (i, q) ->
            let
                u s =
                    { s
                        | query = q
                        , status = Waiting
                    }
            in { model | searches = Array.Extra.update i u model.searches } ! []
        SearchThis i ->
            let
                search = case Array.get i model.searches of
                    Nothing -> initialSearch
                    Just s -> s
                u s =
                    { s | status =
                        if s.query == "" then Waiting else Searching s.query
                    }
                updated = { model | searches = Array.Extra.update i u model.searches }
                fetch = fetchBooks model.baseURL i search.query
            in case search.status of
                Found q _ ->
                    if q == search.query
                        then (model, Cmd.none)
                        else (updated, fetch)
                Searching q ->
                    if q == search.query
                        then (model, Cmd.none)
                        else (updated, fetch)
                Waiting -> (updated, fetch)
                Error _ -> (updated, fetch)
        AddBox ->
            { model
                | searches = Array.push initialSearch model.searches
            } ! []
        FetchFail i err ->
            let u s = { s
                | status = case err of
                    Http.Timeout -> Error "demorou demais"
                    Http.NetworkError -> Error "falha na conexão"
                    Http.UnexpectedPayload s -> Error <| "erro: " ++ s
                    Http.BadResponse _ s -> Error <| "erro no servidor: " ++ s
            }
            in { model | searches = Array.Extra.update i u model.searches } ! []
        FetchSucceed i resquery res ->
            let
                u s =
                    { s | status =
                        if s.query == resquery then Found s.query res
                        else s.status
                    }
            in { model | searches = Array.Extra.update i u model.searches } ! []

urlUpdate : Location -> Model -> (Model, Cmd Msg)
urlUpdate l model = (model, Cmd.none)


-- VIEW

view : Model -> Html Msg
view model =
    let
        getResult : Search -> SearchResults
        getResult s = case s.status of
            Waiting -> Dict.empty
            Searching _ -> Dict.empty
            Error _ -> Dict.empty
            Found _ r -> r
        results = Array.map getResult model.searches
    in
        node "html" []
            [ node "link" [ rel "stylesheet", href "styles.css" ] []
            , node "title" [] [ text "busca múltipla na estante virtual" ]
            , div [ id "container" ]
                [ div [ id "search" ]
                    [ div []
                        ( Array.indexedMap (lazy2 viewSearchBox) model.searches
                            |> Array.toList
                        )
                    , button
                        [ style [ ("display", "block"), ("margin", "auto") ]
                        , onClick AddBox
                        ] [ text "mais um campo de busca" ]
                    ]
                , div [ id "results" ] [ lazy viewResults <| results ]
                ]
            ]


viewSearchBox : Int -> Search -> Html Msg
viewSearchBox i search =
    let
        message = case search.status of
            Waiting -> ""
            Searching _ -> "procurando..."
            Found _ res ->
                let
                    nbooks = List.length <| List.concat <| List.map .books <| Dict.values res
                    nstores = Dict.size res
                in
                    if nbooks == 0 then "nada foi encontrado."
                    else (toString nbooks) ++ " resultados em " ++ (toString nstores) ++ " lojas."
            Error text -> text
    in
        div []
            [ input
                [ name <| "s" ++ (toString i)
                , onBlur <| SearchThis i
                , onInput (\v -> UpdateBox (i, v))
                ] [ text search.query ]
            , span [] [ text message ]
            ]

viewResults : Array SearchResults -> Html Msg
viewResults allResults =
    let
        aggStores : String -> Store -> Dict String Store -> Dict String Store
        aggStores key store acc = Dict.update
            key
            ( \maybeStore ->
                case maybeStore of
                    Nothing -> Just store
                    Just currStore -> Just
                        { currStore
                            | books = List.concat [ currStore.books, store.books ]
                        }
            )
            acc
        aggResults : SearchResults -> Dict String Store -> Dict String Store
        aggResults res acc = Dict.foldl aggStores acc res
        stores : Dict String Store
        stores = Array.foldl aggResults Dict.empty allResults
        byBookCount : Store -> Store -> Order
        byBookCount a b = compare (List.length a.books) (List.length b.books)
        sortedStores : List Store
        sortedStores = List.reverse <| List.sortWith byBookCount <| Dict.values stores
    in
        Keyed.ul []
            (List.map keyedViewStore sortedStores)

keyedViewStore : Store -> (String, Html Msg)
keyedViewStore store =
    ( store.url
    , li []
        [ a [ href store.url, target "_blank" ] [ text store.name ]
        , text ", "
        , text store.place
        , Keyed.node "table" []
            (List.map keyedViewBook store.books)
        ]
    )

keyedViewBook : Book -> (String, Html Msg)
keyedViewBook book =
    ( book.title ++ ", " ++ book.author
    , tr [ class <| (++) "s" <| toString book.searchIndex ]
        [ td [ class "title" ]
            [ b [] [ text book.title ]
            , text <| ", " ++ book.author
            ]
        , Keyed.node "td" [ class "price" ]
            (List.map keyedViewOffer book.offers)
        ]
    )

keyedViewOffer : Offer -> (String, Html Msg)
keyedViewOffer o =
    ( o.url
    , span [ title o.price ]
        [ text " "
        , input [ type' "checkbox" ] []
        , a [ href o.url, target "_blank" ]
            [ text <| Maybe.withDefault "~" <| List.head <| String.split "," o.price ]
        ]
    )


-- HTTP

fetchBooks : String -> Int -> String -> Cmd Msg
fetchBooks baseURL i query =
    let
        url = baseURL ++ "/search?q=" ++ query
        decodeOffer = J.object2 Offer ("price" := J.string) ("url" := J.string)
        decodeBook = J.object4 Book
            ("offers" := (J.list decodeOffer))
            ("author" := J.string)
            ("title" := J.string)
            (J.succeed i) -- searchIndex
        decodeStore = J.object4 Store
            ("books" := (J.list decodeBook))
            ("name" := J.string)
            ("place" := J.string)
            ("url" := J.string)
        decodeResp = J.dict decodeStore
    in
        if query /= "" then
            Task.perform (FetchFail i) (FetchSucceed i query) (Http.get decodeResp url)
        else
            Cmd.none
