// The English side of what this API says out loud.
//
// Keys are the Polish messages exactly as the code writes them; a message
// missing from here goes out in Polish. Only what reaches a person is in here:
// the `error` of a failed call, the notes the settings screen shows about each
// engine and each cutout method. Log lines stay English, as they always were.
//
// A message carrying a value uses a placeholder — `t('Serwer odpowiedział
// {status}', { status })` — because word order is not the same in both
// languages and a sentence glued together from pieces can only be right in one.

export const EN: Record<string, string> = {
  // Signing in
  'Nieprawidłowy e-mail lub hasło': 'Invalid email or password',
  'Obecne hasło jest nieprawidłowe': 'Current password is incorrect',
  'Konto z tym adresem już istnieje': 'An account with that email already exists',
  'Hasło musi mieć co najmniej {n} znaków': 'The password must be at least {n} characters',

  // Not found, taken, already there
  'Nie ma takiego zdjęcia': 'There is no such photo',
  'Nie ma takiego narzędzia': 'There is no such tool',
  'Nie ma takich etykiet': 'There are no such labels',
  'Skrzynka tego organizera nie ma takiego miejsca na etykietę':
    'The case of this arrangement has no such place for a label',
  'Tego narzędzia nie ma w tym organizerze': 'That tool is not in this arrangement',
  'To narzędzie jest już w innym organizerze': 'That tool is already in another arrangement',
  'To zdjęcie jest już na tej karcie': 'That photo is already on this card',
  'To zdjęcie jest już logo innej marki': 'That photo is already another maker’s logo',
  'Takie wycięcie już jest na tej karcie': 'That cutout is already on this card',
  'Marka „{name}” już istnieje': 'The maker “{name}” already exists',
  'Numer {number} jest już zajęty przez inny organizer':
    'Number {number} is already taken by another arrangement',
  'Ta skrzynka ma już miejsce {width} x {height} mm':
    'This case already has a {width} x {height} mm place',

  // What the request has to say
  'Nie wybrano żadnej etykiety': 'No label was chosen',
  'Nie zaznaczono żadnego zdjęcia': 'No photo was selected',
  'Nieprawidłowy identyfikator: {value}': 'Not an identifier: {value}',
  'Podaj adres zdjęcia (url)': 'Give the photo’s address (url)',
  'Podaj adres zdjęcia (url) albo listę (items)':
    'Give the photo’s address (url) or a list (items)',
  'Maksymalnie {max} etykiet naraz': 'At most {max} labels at a time',
  'Maksymalnie {max} zdjęć naraz': 'At most {max} photos at a time',
  'Maksymalnie {max} zdjęcia': 'At most {max} photos',
  'Maksymalnie 200 narzędzi naraz': 'At most 200 tools at a time',
  'Własny tekst może mieć najwyżej {max} znaków':
    'Your own text can be at most {max} characters long',
  'Etykieta {width} × {height} mm mieści {allowed} zdjęcia':
    'A {width} × {height} mm label holds {allowed} photos',
  'Lokalna metoda nie używa klucza': 'The local method uses no key',

  // Fetching a picture from somewhere else
  'Adres musi zaczynać się od http:// albo https://':
    'The address has to start with http:// or https://',
  'Adres wskazuje na sieć lokalną': 'The address points at the local network',
  'Nie udało się rozwiązać adresu': 'The address could not be resolved',
  'Nie udało się pobrać pliku spod tego adresu': 'The file at that address could not be fetched',
  'Nie udało się pobrać zdjęcia': 'The photo could not be fetched',
  'Nie udało się pobrać zdjęć': 'The photos could not be fetched',
  'Nie udało się przypisać zdjęć': 'The photos could not be attached',
  'Serwer odpowiedział {status}': 'The server answered {status}',
  'Plik jest większy niż {mb} MB': 'The file is larger than {mb} MB',
  'Pusta odpowiedź': 'An empty answer',

  // Pictures and previews
  'Nie udało się odczytać zdjęcia': 'The photo could not be read',
  'Nie udało się odczytać pikseli zdjęcia': 'The photo’s pixels could not be read',
  'Nie udało się przekonwertować zdjęcia na PNG: {reason}':
    'The photo could not be converted to PNG: {reason}',
  'Konwersja zwróciła coś, co nie jest obrazem PNG':
    'The conversion returned something that is not a PNG image',
  'nieznany błąd': 'unknown error',
  'Nieznany błąd': 'Unknown error',
  'Podgląd jest uszkodzony': 'The preview is damaged',
  'Podgląd wygasł — wygeneruj go ponownie': 'The preview has expired — generate it again',

  // Cutting the tool out of a photo
  'Żadna metoda wycinania nie jest włączona — sprawdź Ustawienia':
    'No cutout method is switched on — see Settings',
  'Metoda {provider} nie jest dostępna — włącz ją i uzupełnij klucz w Ustawieniach':
    'The {provider} method is unavailable — switch it on and fill in its key in Settings',
  'Usługa wycinania nie odpowiedziała na czas': 'The cutout service did not answer in time',
  'Usługa wycinania odpowiedziała błędem': 'The cutout service answered with an error',
  'Wyczerpany limit usługi wycinania. Spróbuj później.':
    'The cutout service’s quota is used up. Try later.',
  'Wycinanie zwróciło coś, co nie jest obrazem':
    'The cutout returned something that is not an image',
  'Model nie zwrócił obrazu — spróbuj z innym zdjęciem':
    'The model returned no image — try another photo',
  'Nie znaleziono narzędzia na tym zdjęciu': 'No tool was found in this photo',
  'Narzędzie wypełnia już całe zdjęcie — nie ma czego wycinać':
    'The tool already fills the whole photo — there is nothing to cut out',
  'Obiekt na zdjęciu jest za mały — sprawdź, czy to zdjęcie narzędzia':
    'The object in the photo is too small — check that this is a photo of a tool',
  'To zdjęcie nie ma jednolitego jasnego tła — wycinanie bez AI zadziała tylko na zdjęciach katalogowych':
    'This photo has no even, light background — cutting out without AI works on catalog photos only',

  // Searching the web for photos
  'Żadna wyszukiwarka nie jest włączona — sprawdź Ustawienia':
    'No search engine is switched on — see Settings',
  'Wyszukiwanie nie powiodło się': 'The search failed',
  '{provider}: błąd {status}': '{provider}: error {status}',
  '{provider}: nieczytelna odpowiedź': '{provider}: unreadable answer',
  '{provider}: wyczerpany limit zapytań': '{provider}: query quota used up',

  // What the settings screen says about each engine and each method
  'Bez klucza, działa od razu. Indeksuje zdjęcia na wolnych licencjach, więc znajdzie „szlifierkę kątową”, ale nie „GWS 180-LI”.':
    'No key, works straight away. It indexes freely licensed photos, so it will find “an angle grinder” but not “GWS 180-LI”.',
  'Najlepsze wyniki dla konkretnych modeli. Wymaga klucza z Google Cloud i identyfikatora wyszukiwarki (cx). Darmowe 100 zapytań dziennie.':
    'The best results for particular models. Needs a key from Google Cloud and a search engine id (cx). 100 free queries a day.',
  'Wyszukiwarka grafiki z własnym indeksem. Klucz z api-dashboard.search.brave.com, darmowy pakiet miesięczny.':
    'An image search with an index of its own. Key from api-dashboard.search.brave.com, with a free monthly allowance.',
  'Sklep z elektronarzędziami. Nie szuka obrazków w sieci — znajduje kartę produktu i bierze zdjęcia z jej galerii, więc dostaje się komplet ujęć jednego modelu w pełnej rozdzielczości. Bez klucza. Zna tylko to, czym sklep handluje.':
    'A power tool shop. It does not search the web for pictures — it finds the product page and takes the photos from its gallery, so you get a full set of shots of one model at full resolution. No key. It knows only what the shop sells.',
  'Bez klucza, odpowiedź w ułamku sekundy, przezroczyste tło. Działa na zdjęciach katalogowych — narzędzie na jasnym, jednolitym tle; inne odrzuca.':
    'No key, an answer in a fraction of a second, a transparent background. It works on catalog photos — a tool on a light, even ground; anything else it refuses.',
  'Usługa zbudowana do wycinania. Radzi sobie ze zdjęciami z ręki i z warsztatu, zwraca przezroczyste PNG. Klucz z remove.bg/api, 50 zdjęć miesięcznie za darmo.':
    'A service built for cutting out. It copes with handheld and workshop photos and returns a transparent PNG. Key from remove.bg/api, 50 photos a month free.',
  'Model ogólny. Zwraca narzędzie na jednolitym białym tle, bez przezroczystości. Klucz z aistudio.google.com — inny niż ten do wyszukiwarki.':
    'A general model. It returns the tool on an even white ground, with no transparency. Key from aistudio.google.com — a different one from the search key.',
  'Lokalny skrypt': 'Local script',
  'Klucz remove.bg': 'remove.bg key',
  'Klucz Gemini': 'Gemini key',
}
