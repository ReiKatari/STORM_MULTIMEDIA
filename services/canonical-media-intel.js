/**
 * STORM MULTIMEDIA - Модуль канонических метаданных (Intelligence Layer)
 * Обеспечивает 100% точность типов медиа, годов премьер и жанров
 */

// База канонических годов релиза (фильмы, сериалы, аниме)
export const KNOWN_RELEASE_YEARS = {
  // Аниме и новинки 2026
  'история о перекуре за супермаркетом': '2026',
  'super no ura de yani suu futari': '2026',
  'человек паук новый день': '2026',
  'человек-паук: новый день': '2026',
  'spider man brand new day': '2026',
  'spider-man: brand new day': '2026',
  'чужая мама': '2026',
  'other mommy': '2026',
  'кэрри': '2026',
  'carrie': '2026',
  'проект конец света': '2026',
  'закулисье реальности': '2026',
  'хитрый койот': '2026',
  'миньоны и монстры': '2026',
  'бэтмен падение рыцаря': '2026',
  'аватар аанг последний маг воздуха': '2026',
  'легенда об аанге': '2026',
  'прыгуны': '2026',
  'робоцып спецвыпуск adult swim': '2026',
  'goat мечтай по крупному': '2026',
  'история игрушек 5': '2026',
  'одиссея': '2026',
  'мандалорец и грогу': '2026',
  'мстители судный день': '2026',
  'бэтмен часть 2': '2026',
  'бэтмен 2': '2026',
  'тайный дневник верити': '2026',
  'verity': '2026',

  // Новинки 2025
  'аватар 3 пламя и пепел': '2025',
  'аватар 3: пламя и пепел': '2025',
  'аватар пламя и пепел': '2025',
  'аватар: пламя и пепел': '2025',
  'аватар 3': '2025',
  'хищник планета смерти': '2025',
  'хищник: планета смерти': '2025',
  'планета смерти': '2025',
  'дандадан 2': '2025',
  'dandadan 2': '2025',
  'dandadan season 2': '2025',
  'стюарт блум не смог спасти вселенную': '2025',
  'обитель зла мутация': '2025',
  'обитель зла: мутация': '2025',
  'человек бензопила фильм история резе': '2025',
  'человек-бензопила. фильм: история резе': '2025',
  'человек бензопила история резе': '2025',
  'история резе': '2025',
  'зверополис 2': '2025',
  'мэйдэй': '2025',
  'mayday': '2025',
  'супермен': '2025',
  'микки 17': '2025',
  '28 лет спустя': '2025',
  'балерина': '2025',
  'иллюзия обмана 3': '2025',
  'франкенштейн': '2025',
  'дракула': '2025',
  'обезьяна': '2025',

  // Новинки 2024
  'темная материя': '2024',
  'тёмная материя': '2024',
  'dark matter': '2024',
  'падение империи': '2024',
  'civil war': '2024',
  'дюна часть вторая': '2024',
  'дюна: часть вторая': '2024',
  'dune part two': '2024',
  'dune: part two': '2024',
  'дэдпул и росомаха': '2024',
  'deadpool & wolverine': '2024',
  'гладиатор 2': '2024',
  'дикий робот': '2024',
  'головоломка 2': '2024',
  'кунг фу панда 4': '2024',
  'кунг-фу панда 4': '2024',
  'субстанция': '2024',
  'the substance': '2024',
  'ужасающий 3': '2024',
  'джокер безумие на двоих': '2024',
  'джокер: безумие на двоих': '2024',
  'тихое место день первый': '2024',
  'тихое место: день первый': '2024',
  'чужой ромул': '2024',
  'чужой: ромул': '2024',
  'alien romulus': '2024',
  'соник 3 в кино': '2024',
  'муфаса король лев': '2024',
  'муфаса: король лев': '2024',
  'носферату': '2024',
  'веном последний танец': '2024',
  'веном: последний танец': '2024',
  'битлджус битлджус': '2024',
  'фуриоса': '2024',
  'furiosa': '2024',
  'фуриоса хроники безумного макса': '2024',
  'фуриоса: хроники безумного макса': '2024',
  'гадкий я 4': '2024',
  'мастер и маргарита': '2024',
  'майор гром игра': '2024',
  'майор гром: игра': '2024',
  'сто лет тому вперед': '2024',
  'сто лет тому вперёд': '2024',
  'холоп 2': '2024',

  // 2023
  'я не киллер': '2023',
  'hit man': '2023',
  'пассажир': '2023',
  'the passenger': '2023',
  'мистер робот': '2015',
  'mr. robot': '2015',
  'ходячие мертвецы': '2010',
  'the walking dead': '2010',
  'остаться в живых': '2004',
  'lost': '2004',
  'спартак: кровь и песок': '2010',
  'спартак': '2010',
  'spartacus': '2010',
  'персонажи в клетке': '2024',
  'кафе из другого мира': '2017',
  'isekai shokudou': '2017',
  'дандадан': '2024',
  'дан да дан': '2024',
  'джек ричер': '2022',
  'ричер': '2022',
  'reacher': '2022',
  'укрытие': '2023',
  'бункер': '2023',
  'silo': '2023',
  'укрытие (2 сезон)': '2024',
  'разделение': '2022',
  'severance': '2022',
  'игра престолов': '2011',
  'дом дракона': '2022',
  'пацаны': '2019',
  'поколение «ви»': '2023',
  'очень странные дела': '2016',
  'властелин колец: кольца власти': '2022',
  'кольца власти': '2022',
  'сёгун': '2024',
  'сегун': '2024',
  'shogun': '2024',
  'shōgun': '2024',
  'фоллаут': '2024',
  'fallout': '2024',
  'пингвин': '2024',
  'the penguin': '2024',
  'джентльмены': '2024',
  'the gentlemen': '2024',
  'одни из нас': '2023',
  'the last of us': '2023',
  'мандалорец': '2019',
  'андор': '2022',
  'локи': '2021',
  'ведьмак': '2019',
  'чернобыль': '2019',
  'во все тяжкие': '2008',
  'лучше звоните солу': '2015',
  'медведь': '2022',
  'шерлок': '2010',
  'доктор хаус': '2004',
  'острые козырьки': '2013',
  'монстры': '2022',
  'монстр: история джеффри дамера': '2022',
  'монстр история джеффри дамера': '2022',
  'менталист': '2008',
  'the mentalist': '2008',
  'дневники вампира': '2009',
  'the vampire diaries': '2009',
  'одиссея': '2026',
  'кэрри': '2026',
  'carrie': '2026',

  // Аниме-сериалы
  'аркейн': '2021',
  'аркейн (2 сезон)': '2024',
  'поднятие уровня в одиночку': '2024',
  'поднятие уровня в одиночку (2 сезон)': '2025',
  'поднятие уровня в одиночку 2': '2025',
  'соло левелинг': '2024',
  'клинок, рассекающий демонов': '2019',
  'магическая битва': '2020',
  'человек-бензопила': '2022',
  'человек-бензопила. фильм: история резе': '2025',
  'кайдзю номер 8': '2024',
  'кайдзю номер 8 (2 сезон)': '2025',
  'семья шпиона': '2022',
  'фрирен, провожающая в последний путь': '2023',
  'фрирен': '2023',
  'атака титанов': '2013',
  'киберпанк: бегущие по краю': '2022',
  'звёздные войны: видения': '2021',
  'звездные войны: видения': '2021',
  'звёздные войны видения': '2021',
  'звездные войны видения': '2021',
  'звёздные войны: видение': '2021',
  'звездные войны: видение': '2021',
  'star wars: visions': '2021',
  'star wars visions': '2021',

  // Киношедевры и франшизы
  'изгой-один: звёздные войны. истории': '2016',
  'изгой-один': '2016',
  'rogue one': '2016',
  'интерстеллар': '2014',
  'interstellar': '2014',
  'начало': '2010',
  'inception': '2010',
  'тёмный рыцарь': '2008',
  'темный рыцарь': '2008',
  'тёмный рыцарь: возрождение легенды': '2012',
  'бэтмен: начало': '2005',
  'престиж': '2006',
  'дюнкерк': '2017',
  'довод': '2020',
  'оппенгеймер': '2023',
  'дюна': '2021',
  'дюна: часть вторая': '2024',
  'дэдпул и росомаха': '2024',
  'гладиатор 2': '2024',
  'гладиатор': '2000',
  'дикий робот': '2024',
  'головоломка 2': '2024',
  'головоломка': '2015',
  'моана 2': '2024',
  'моана': '2016',
  'кунг-фу панда 4': '2024',
  'гадкий я 4': '2024',
  'чужой: ромул': '2024',
  'чужой': '1979',
  'чужие': '1986',
  'чужой 3': '1992',
  'чужой: воскрешение': '1997',
  'прометей': '2012',
  'чужой: завет': '2017',
  'матрица': '1999',
  'матрица: перезагрузка': '2003',
  'матрица: революция': '2003',
  'матрица: воскрешение': '2021',
  'терминатор': '1984',
  'терминатор 2: судный день': '1991',
  'терминатор 3: восстание машин': '2003',
  'терминатор: да придёт спаситель': '2009',
  'терминатор: генезис': '2015',
  'терминатор: тёмные судьбы': '2019',
  'властелин колец: братство кольца': '2001',
  'властелин колец: две крепости': '2002',
  'властелин колец: возвращение короля': '2003',
  'властелин колец: война рохирримов': '2024',
  'война рохирримов': '2024',
  'хоббит: нежданное путешествие': '2012',
  'хоббит: пустошь смауга': '2013',
  'хоббит: битва пяти воинств': '2014',
  'гарри поттер и философский камень': '2001',
  'гарри поттер и тайная комната': '2002',
  'гарри поттер и узник азкабана': '2004',
  'гарри поттер и кубок огня': '2005',
  'гарри поттер и орден феникса': '2007',
  'гарри поттер и принц-полукровка': '2009',
  'гарри поттер и дары смерти: часть 1': '2010',
  'гарри поттер и дары смерти: часть 2': '2011',
  'гарри поттер': '2001',
  'пираты карибского моря: проклятие чёрной жемчужины': '2003',
  'пираты карибского моря: сундук мертвеца': '2006',
  'пираты карибского моря: на краю света': '2007',
  'пираты карибского моря: на странных берегах': '2011',
  'аватар 2 путь воды': '2022',
  'аватар 2: путь воды': '2022',
  'аватар 2': '2022',
  'аватар путь воды': '2022',
  'аватар: путь воды': '2022',
  'avatar the way of water': '2022',
  'avatar 2': '2022',
  'аватар': '2009',
  'бойцовский клуб': '1999',
  'криминальное чтиво': '1994',
  'побег из шоушенка': '1994',
  'зеленая миля': '1999',
  'зелёная миля': '1999',
  'леон': '1994',
  'пятый элемент': '1997',
  'бегущий по лезвию 2049': '2017',
  'бегущий по лезвию': '1982',
  '1917': '2019',
  '2012': '2009',
  '1984': '1984',
  'космическая одиссея 2001 года': '1968'
};

// Реестр известных сериалов (гарантирует тип 'series')
export const KNOWN_SERIES = [
  'мистер робот', 'mr. robot', 'mr robot',
  'ходячие мертвецы', 'the walking dead',
  'остаться в живых', 'lost',
  'спартак', 'спартак: кровь и песок', 'spartacus',
  'новичок', 'the rookie',
  'извне', 'from',
  'декстер', 'dexter', 'декстер: первородный грех', 'dexter: original sin', 'декстер: новая кровь', 'dexter: new blood',
  'медленные лошади', 'slow horses',
  'йеллоустоун', 'yellowstone',
  'мэр кингстауна', 'mayor of kingstown',
  'кобра кай', 'cobra kai',
  'сопрано', 'клан сопрано', 'the sopranos',
  'прослушка', 'the wire',
  'игра в кальмара', 'squid game',
  'секретные материалы', 'the x-files',
  'джек ричер', 'ричер', 'reacher',
  'стюарт блум не смог спасти вселенную',
  'укрытие', 'бункер', 'silo',
  'разделение', 'severance',
  'игра престолов', 'дом дракона', 'house of the dragon',
  'пацаны', 'the boys', 'поколение «ви»', 'поколение ви', 'gen v',
  'очень странные дела', 'stranger things', 'кольца власти',
  'сёгун', 'сегун', 'shogun', 'shōgun',
  'фоллаут', 'fallout',
  'пингвин', 'the penguin',
  'джентльмены', 'the gentlemen',
  'одни из нас', 'the last of us',
  'мандалорец', 'андор', 'локи',
  'ведьмак', 'the witcher', 'чернобыль', 'во все тяжкие', 'breaking bad', 'лучше звоните солу', 'better call saul',
  'медведь', 'the bear', 'шерлок', 'доктор хаус', 'острые козырьки', 'peaky blinders',
  'настоящий детектив', 'true detective', 'фарго', 'fargo', 'мир дикого запада', 'тьма', 'dark',
  'чёрное зеркало', 'черное зеркало', 'black mirror', 'сверхъестественное', 'supernatural', 'викинги', 'vikings',
  'слово пацана', 'вампиры средней полосы', 'триггер', 'метод', 'мажор',
  'кухня', 'интерны', 'эпидемия', 'фишер', 'корона', 'the crown', 'уэнсдэй', 'уэнсдей', 'wednesday', 'миротворец',
  'бумажный дом', 'money heist', 'озарк', 'ozark', 'академия амбрелла', 'the umbrella academy',
  'ганнибал', 'hannibal', 'гримм', 'grimm', 'бесстыжие', 'shameless', 'ривердейл', 'riverdale', 'эйфория', 'euphoria',
  'люцифер', 'lucifer', 'теория большого взрыва', 'the big bang theory', 'детство шелдона', 'young sheldon',
  'друзья', 'friends', 'офис', 'the office', 'клиника', 'scrubs', 'универ', 'реальные пацаны', 'след', 'глухарь', 'невский',
  'король талсы', 'tulsa king', 'основание', 'foundation',
  'целую, китти', 'целую китти', 'xo, kitty', 'xo kitty',
  'голяк', 'brassic',
  'рыцарь семи королевств', 'a knight of the seven kingdoms',
  'сорвиголова: рождённый заново', 'сорвиголова: рожденный заново', 'daredevil: born again',
  'гангстерленд', 'mobland',
  'белый лотос', 'the white lotus',
  'монстры', 'монстр', 'монстр: история джеффри дамера', 'монстры: история', 'монстры: история лайла и эрика менендес', 'monsters', 'monster: the jeffrey dahmer story', 'monsters: the lyle and erik menendez story',
  'менталист', 'the mentalist', 'mentalist',
  'дневники вампира', 'the vampire diaries', 'vampire diaries', 'первородные', 'the originals', 'наследие', 'legacies',
  'побег', 'побег из тюрьмы', 'prison break',
  'анатомия страсти', "grey's anatomy", 'greys anatomy',
  'форс-мажоры', 'suits', 'миллиарды', 'billions', 'наследники', 'succession',
  'черный список', 'чёрный список', 'the blacklist', 'карточный домик', 'house of cards',
  'вечность', 'forever', 'как я встретил вашу маму', 'how i met your mother',
  'американская история ужасов', 'american horror story', 'американская история преступлений', 'american crime story',
  'большая маленькая ложь', 'big little lies', 'молодой папа', 'the young pope', 'новый папа', 'the new pope',
  'сыны анархии', 'sons of anarchy', 'щит', 'the shield', 'блудливая калифорния', 'californication',
  'безумцы', 'mad men', 'родина', 'homeland', '24 часа', '24', 'герои', 'heroes', 'сотня', 'the 100',
  'стрела', 'arrow', 'флэш', 'the flash', 'готэм', 'gotham', 'тайны смолвиля', 'smallville',
  'доктор кто', 'doctor who', 'лютер', 'luther', 'мост', 'the bridge',
  'кэрри', 'carrie',
  'темная материя', 'тёмная материя', 'dark matter'
];

export const KNOWN_SERIES_SEASONS = {
  'темная материя': 2,
  'тёмная материя': 2,
  'dark matter': 2,
  'ландыши': 2,
  'бункер': 2,
  'укрытие': 2,
  'silo': 2,
  'разделение': 2,
  'severance': 2,
  'дом дракона': 2,
  'house of the dragon': 2,
  'игра в кальмара': 2,
  'squid game': 2,
  'ричер': 3,
  'reacher': 3,
  'звёздные войны: видения': 4,
  'звездные войны: видения': 4,
  'звёздные войны видения': 4,
  'звездные войны видения': 4,
  'star wars: visions': 4,
  'star wars visions': 4
};

// Реестр известных аниме (по умолчанию 'anime-series', если не фильм)
export const KNOWN_ANIME_SERIES = [
  'персонажи в клетке',
  'кафе из другого мира', 'isekai shokudou',
  'история о перекуре за супермаркетом', 'super no ura de yani suu futari',
  'дандадан', 'dandadan',
  'аркейн', 'arcane',
  'поднятие уровня в одиночку', 'соло левелинг', 'solo leveling',
  'клинок, рассекающий демонов', 'demon slayer',
  'атака титанов', 'attack on titan',
  'магическая битва', 'jujutsu kaisen',
  'человек-бензопила', 'chainsaw man',
  'кайдзю номер 8', 'kaiju no. 8',
  'семья шпиона', 'spy x family',
  'фрирен', 'frieren',
  'киберпанк: бегущие по краю', 'cyberpunk',
  'звёздные войны: видения', 'звездные войны: видения', 'звездные войны видения', 'star wars: visions', 'star wars visions',
  'клеватесс', 'революция книжного червя', 'адский режим',
  'блич', 'наруто', 'ван-пис', 'тетрадь смерти', 'токийский гуль'
];

// Реестр известных анимационных фильмов (строго 'cartoon', никогда не 'series')
export const KNOWN_ANIMATED_MOVIES = [
  'обитель зла: вендетта', 'обитель зла вендетта', 'resident evil: vendetta',
  'обитель зла: вырождение', 'обитель зла вырождение', 'resident evil: degeneration',
  'обитель зла: проклятие', 'обитель зла проклятие', 'resident evil: damnation',
  'обитель зла: остров смерти', 'обитель зла остров смерти', 'resident evil: death island',
  'человек-паук: через вселенные', 'spider-man: into the spider-verse',
  'человек-паук: паутина вселенных', 'spider-man: across the spider-verse',
  'кот в сапогах: последнее желание', 'кот в сапогах', 'puss in boots',
  'головоломка 2', 'головоломка', 'inside out',
  'зверополис', 'zootopia',
  'дикий робот', 'the wild robot',
  'тайна коко', 'coco',
  'кунг-фу панда', 'кунг-фу панда 4', 'kung fu panda',
  'как приручить дракона', 'how to train your dragon',
  'ледниковый период', 'ice age',
  'гадкий я 4', 'гадкий я', 'despicable me',
  'миньоны', 'minions',
  'шрек', 'shrek',
  'корпорация монстров', 'monsters inc',
  'рататуй', 'ratatouille',
  'валли', 'wall-e', 'валл-и',
  'вверх', 'up'
];

// Реестр известных мультсериалов (строго 'cartoon-series')
export const KNOWN_CARTOON_SERIES = [
  'рик и морти', 'rick and morty',
  'гриффины', 'family guy',
  'симпсоны', 'the simpsons',
  'южный парк', 'south park',
  'футурама', 'futurama',
  'гравити фолз', 'gravity falls',
  'время приключений', 'adventure time',
  'звёздные войны: войны клонов', 'войны клонов', 'the clone wars',
  'звёздные войны: бракованная партия', 'the bad batch',
  'человек-паук 1994', 'spider-man 1994',
  'бэтмен 1992', 'batman the animated series',
  'аватар: легенда об аанге', 'легенда об аанге', 'avatar: the last airbender',
  'легенда о корре', 'the legend of korra',
  'неуязвимый', 'invincible',
  'любовь, смерть и роботы', 'любовь смерть и роботы', 'love, death & robots',
  'губка боб', 'губка боб квадратные штаны', 'spongebob',
  'первобытный', 'primal',
  'смешарики', 'фиксики', 'маша и медведь',
  'утиные истории', 'duck tales', 'ducktails',
  'чип и дейл', 'chip n dale',
  'трансформеры', 'transformers prime',
  'аркейн', 'arcane',
  'дом совы', 'the owl house',
  'амфибия', 'amphibia'
];

// Каноническая база жанров
export const KNOWN_MEDIA_GENRES = {
  'монстры': ['Сериал', 'Драма', 'Криминал', 'Биография'],
  'монстр': ['Сериал', 'Драма', 'Криминал', 'Биография'],
  'монстр: история джеффри дамера': ['Сериал', 'Драма', 'Криминал', 'Биография'],
  'монстры: история лайла и эрика менендес': ['Сериал', 'Драма', 'Криминал', 'Биография'],
  'менталист': ['Сериал', 'Детектив', 'Драма', 'Криминал'],
  'the mentalist': ['Сериал', 'Детектив', 'Драма', 'Криминал'],
  'дневники вампира': ['Сериал', 'Фэнтези', 'Драма', 'Мелодрама'],
  'the vampire diaries': ['Сериал', 'Фэнтези', 'Драма', 'Мелодрама'],
  'кэрри': ['Сериал', 'Ужасы', 'Драма'],
  'carrie': ['Сериал', 'Ужасы', 'Драма'],
  'одиссея': ['Фильм', 'Фантастика', 'Приключения', 'Боевик'],
  'корпорация монстров': ['Мультфильм', 'Комедия', 'Семейный', 'Фэнтези'],
  'монстры на каникулах': ['Мультфильм', 'Комедия', 'Семейный', 'Фэнтези'],
  'пассажир': ['Боевик', 'Триллер', 'Детектив'],
  'персонажи в клетке': ['Комедия', 'Аниме', 'Повседневность'],
  'кафе из другого мира': ['Аниме', 'Фэнтези', 'Повседневность'],
  'мистер робот': ['Драма', 'Триллер', 'Криминал'],
  'ходячие мертвецы': ['Ужасы', 'Триллер', 'Драма'],
  'остаться в живых': ['Фантастика', 'Детектив', 'Драма', 'Приключения'],
  'спартак: кровь и песок': ['Боевик', 'Драма', 'История', 'Приключения'],
  'спартак': ['Боевик', 'Драма', 'История', 'Приключения'],
  'джек ричер': ['Боевик', 'Триллер', 'Криминал', 'Детектив'],
  'ричер': ['Боевик', 'Триллер', 'Криминал', 'Детектив'],
  'reacher': ['Боевик', 'Триллер', 'Криминал', 'Детектив'],
  'история о перекуре за супермаркетом': ['Аниме', 'Романтика', 'Комедия', 'Повседневность'],
  'super no ura de yani suu futari': ['Аниме', 'Романтика', 'Комедия', 'Повседневность'],
  'дандадан': ['Аниме', 'Комедия', 'Фантастика', 'Боевик'],
  'стюарт блум не смог спасти вселенную': ['Комедия', 'Фантастика', 'Сериал'],
  'обитель зла: мутация': ['Ужасы', 'Боевик', 'Фантастика'],
  'обитель зла': ['Ужасы', 'Боевик', 'Фантастика'],
  'укрытие': ['Фантастика', 'Драма', 'Триллер'],
  'бункер': ['Фантастика', 'Драма', 'Триллер'],
  'silo': ['Фантастика', 'Драма', 'Триллер'],
  'человек-паук: новый день': ['Фантастика', 'Боевик', 'Приключения'],
  'человек-паук': ['Фантастика', 'Боевик', 'Приключения'],
  'джентльмены': ['Криминал', 'Комедия', 'Боевик'],
  'дюна': ['Фантастика', 'Приключения', 'Драма'],
  'дюна: часть вторая': ['Фантастика', 'Приключения', 'Драма'],
  'пингвин': ['Криминал', 'Драма'],
  'гладиатор': ['Боевик', 'Приключения', 'Драма'],
  'гладиатор 2': ['Боевик', 'Приключения', 'Драма'],
  'сёгун': ['Драма', 'История', 'Военный'],
  'сегун': ['Драма', 'История', 'Военный'],
  'аркейн': ['Аниме', 'Фантастика', 'Боевик'],
  'поднятие уровня в одиночку': ['Аниме', 'Фэнтези', 'Боевик'],
  'соло левелинг': ['Аниме', 'Фэнтези', 'Боевик'],
  'дэдпул и росомаха': ['Фантастика', 'Боевик', 'Комедия', 'Приключения'],
  'дэдпул': ['Фантастика', 'Боевик', 'Комедия', 'Приключения'],
  'з л о сборник': ['Ужасы', 'Триллер', 'Мистика'],
  'з л о': ['Ужасы', 'Триллер', 'Мистика'],
  'фоллаут': ['Фантастика', 'Боевик', 'Приключения'],
  'дикий робот': ['Мультфильм', 'Фантастика', 'Семейный'],
  'головоломка': ['Мультфильм', 'Семейный', 'Комедия'],
  'головоломка 2': ['Мультфильм', 'Семейный', 'Комедия'],
  'моана': ['Мультфильм', 'Семейный', 'Приключения'],
  'моана 2': ['Мультфильм', 'Семейный', 'Приключения'],
  'кунг-фу панда': ['Мультфильм', 'Боевик', 'Комедия'],
  'кунг-фу панда 4': ['Мультфильм', 'Боевик', 'Комедия'],
  'чужой': ['Ужасы', 'Фантастика', 'Триллер'],
  'чужой: ромул': ['Ужасы', 'Фантастика', 'Триллер'],
  'оппенгеймер': ['Драма', 'История', 'Биография'],
  'интерстеллар': ['Фантастика', 'Драма', 'Приключения'],
  'начало': ['Фантастика', 'Боевик', 'Триллер'],
  'тёмный рыцарь': ['Боевик', 'Криминал', 'Драма'],
  'темный рыцарь': ['Боевик', 'Криминал', 'Драма'],
  'пацаны': ['Фантастика', 'Боевик', 'Комедия'],
  'матрица': ['Фантастика', 'Боевик'],
  'терминатор': ['Фантастика', 'Боевик'],
  'властелин колец': ['Фэнтези', 'Приключения'],
  'хоббит': ['Фэнтези', 'Приключения'],
  'гарри поттер': ['Фэнтези', 'Приключения', 'Семейный'],
  'звёздные войны': ['Фантастика', 'Боевик', 'Приключения'],
  'изгой-один': ['Фантастика', 'Боевик', 'Приключения'],
  'игра престолов': ['Фэнтези', 'Драма', 'Боевик'],
  'дом дракона': ['Фэнтези', 'Драма', 'Боевик'],
  'разделение': ['Фантастика', 'Триллер', 'Драма'],
  'клинок, рассекающий демонов': ['Аниме', 'Фэнтези', 'Боевик'],
  'атака титанов': ['Аниме', 'Боевик', 'Драма', 'Фэнтези'],
  'магическая битва': ['Аниме', 'Фэнтези', 'Боевик'],
  'человек-бензопила': ['Аниме', 'Боевик', 'Ужасы'],
  'кайдзю номер 8': ['Аниме', 'Фантастика', 'Боевик'],
  'семья шпиона': ['Аниме', 'Комедия', 'Боевик'],
  'фрирен': ['Аниме', 'Фэнтези', 'Приключения'],
  'киберпанк: бегущие по краю': ['Аниме', 'Фантастика', 'Боевик'],
  'бегущий по лезвию': ['Фантастика', 'Триллер', 'Детектив'],
  'мэйдэй': ['Боевик', 'Приключения'],
  'клеватесс': ['Аниме', 'Фэнтези', 'Приключения'],
  'революция книжного червя': ['Аниме', 'Фэнтези', 'Повседневность'],
  'адский режим': ['Аниме', 'Фэнтези', 'Боевик']
};

/**
 * Очистка названия для поиска в базах знаний
 */
function normalizeTitle(title = '') {
  return String(title || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`]/g, '')
    .replace(/[:—–-]/g, ' ')
    .replace(/\s*[\(\[]?\s*(?:постер|4[kк]|uhd|fhd|сериал|фильм|\d+\s*сезон|сезон\s*\d+|19\d\d|20\d\d).*?[\)\]]?/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Интеллектуальное определение типа медиа
 * @returns {'series' | 'movie' | 'anime-series' | 'anime-movie' | 'cartoon-series' | 'cartoon' | 'show'}
 */
export function resolveCanonicalMediaType(title = '', link = '', category = '', genres = '', item = {}) {
  const norm = normalizeTitle(title);
  const linkStr = String(link || '').toLowerCase();
  const catStr = String(category || '').toLowerCase();
  const genStr = (Array.isArray(genres) ? genres.join(' ') : String(genres || '')).toLowerCase();
  const src = String(item?.source || item?.src || '').toLowerCase();

  // Тёмная материя (Dark Matter) - сериал Apple TV+ (2 сезона)
  if (norm === 'темная материя' || norm.startsWith('темная материя') || norm === 'dark matter' || norm.startsWith('dark matter')) {
    return 'series';
  }

  // 0. Обитель зла: Мутация - строго художественный фильм (movie), не анимация и не сериал!
  if (norm.includes('обитель зла') && (norm.includes('мутация') || norm.includes('мутиция'))) {
    return 'movie';
  }

  // Дюна и Дюна: Часть вторая - строго художественный фильм (movie), ни в коем случае не сериал!
  if (norm === 'дюна' || norm.startsWith('дюна:') || norm.startsWith('дюна ') || norm.includes('дюна: часть') || norm.includes('дюна часть')) {
    return 'movie';
  }

  // Кэрри (2026) - сериал от Майка Флэнагана для Prime Video
  if (norm === 'кэрри' || norm.startsWith('кэрри ') || norm.startsWith('кэрри:') || norm === 'carrie' || norm.startsWith('carrie ') || norm.startsWith('carrie:')) {
    return 'series';
  }

  // 1. Приоритетная проверка известных анимационных фильмов (Вырождение, Вендетта и др.)
  // Строго возвращает 'cartoon', предотвращая ложную классификацию как сериал из-за дубляжей или плееров
  if (KNOWN_ANIMATED_MOVIES.some(m => norm === m || norm.startsWith(m + ' ') || norm.includes(m))) {
    return 'cartoon';
  }

  // 2. Приоритетная проверка известных мультсериалов (Рик и Морти, Симпсоны, Гриффины и др.)
  if (KNOWN_CARTOON_SERIES.some(s => norm === s || norm.startsWith(s + ' ') || norm.includes(s))) {
    return 'cartoon-series';
  }

  // 3. Признаки аниме
  const isAnime = src === 'anilibria' || src === 'anixart' || src === 'shikimori' ||
                  catStr.includes('anime') || linkStr.includes('anime') || genStr.includes('аниме') ||
                  String(item.media_type || '').includes('anime') || ((Array.isArray(item.countries) ? item.countries.join(' ') : String(item.countries || '')).toLowerCase().match(/japan|япони/) && (genStr.includes('мульт') || catStr.includes('cartoon') || catStr.includes('anime'))) ||
                  KNOWN_ANIME_SERIES.some(a => norm.includes(a));

  if (isAnime) {
    const hasAnimeEps = (parseInt(item.total_episodes, 10) > 1) || (parseInt(item.episode, 10) > 1) || (parseInt(item.episodes_total, 10) > 1) || (parseInt(item.episodes_released, 10) > 1) || (Array.isArray(item.seasons) && item.seasons.length > 0);
    if (norm.includes('фильм') || norm.includes('movie') || catStr === 'anime-movies' || catStr === 'anime-movie' || item.media_type === 'anime-movie' || (item.category && String(item.category).includes('Фильм')) || (!hasAnimeEps && item.media_type === 'movie')) {
      return 'anime-movie';
    }
    return 'anime-series';
  }

  // 4. Признаки мультфильмов
  const isCartoon = catStr.includes('cartoon') || linkStr.includes('mult') || genStr.includes('мульт') || norm.includes('мульт');
  if (isCartoon) {
    const hasEpisodes = (parseInt(item.total_episodes, 10) > 1) || (parseInt(item.episode, 10) > 1) ||
                        (parseInt(item.episodes_total, 10) > 1) || (parseInt(item.episodes_released, 10) > 1) ||
                        linkStr.includes('serial') || catStr.includes('series');
    return hasEpisodes ? 'cartoon-series' : 'cartoon';
  }

  // 3. Строгая проверка на сериал по объекту, флагу или реестру известных сериалов
  if (item.isSeries || item.is_series || item.media_type === 'series' || item.type === 'series' || item.type === 'tv') {
    return 'series';
  }

  // Защита от мультфильмов со словом монстр/монстры (Корпорация монстров, Монстры на каникулах и др. - строго мультфильмы)
  const isMonsterCartoonOrMovie = [
    'корпорация монстров', 'университет монстров', 'монстры на каникулах', 
    'монстры против пришельцев', 'миньоны и монстры', 'монстр траки', 'монстро'
  ].some(m => norm === m || norm.startsWith(m + ' ') || norm.includes(m));

  if (!isMonsterCartoonOrMovie) {
    if (norm === 'монстры' || norm.startsWith('монстры ') || norm.startsWith('монстры:') ||
        norm === 'монстр' || norm.startsWith('монстр ') || norm.startsWith('монстр:') ||
        norm === 'monsters' || norm.startsWith('monsters ') || norm === 'monster' || norm.startsWith('monster ') ||
        linkStr.includes('monstr-istorija') || linkStr.includes('menendez') || linkStr.includes('dahmer')) {
      return 'series';
    }
  }

  // Менталист и Дневники вампира
  if (norm.includes('менталист') || norm.includes('mentalist') || linkStr.includes('mentalist')) {
    return 'series';
  }
  if (norm.includes('дневники вампира') || norm.includes('vampire diaries') || linkStr.includes('dnevniki-vampira')) {
    return 'series';
  }

  if (KNOWN_SERIES.some(s => norm === s || norm.startsWith(s + ' ') || norm.includes(s))) {
    return 'series';
  }

  // 4. Признаки многосерийности из объекта item
  const ep = parseInt(item.episode, 10) || 0;
  const totalEp = parseInt(item.total_episodes, 10) || parseInt(item.episodes_total, 10) || parseInt(item.episodes_released, 10) || 0;
  const season = parseInt(item.season, 10) || 0;
  const epWatched = parseInt(item.episodes_watched, 10) || 0;
  if (ep > 1 || totalEp > 1 || season > 1 || epWatched > 0) {
    return 'series';
  }

  // 5. Признаки из URL, категорий, жанров и названий
  if (linkStr.includes('serial') || linkStr.includes('fan-serials') || linkStr.includes('season') ||
      catStr.includes('series') || catStr.includes('serial') ||
      genStr.includes('сериал') || genStr.includes('дорама') ||
      norm.includes('сериал') || norm.includes('сезон') || /сезон\s*\d+/i.test(String(title))) {
    return 'series';
  }

  if (catStr === 'shows' || linkStr.includes('show')) {
    return 'show';
  }

  return 'movie';
}

/**
 * Интеллектуальное определение точного года выпуска
 */
export function resolveCanonicalYear(title = '', link = '', poster = '', dateStr = '', existingYear = '') {
  const norm = normalizeTitle(title);

  // 0. Тёмная материя (Dark Matter) - официальный релиз 2024 года
  if (norm === 'темная материя' || norm.startsWith('темная материя') || norm === 'dark matter' || norm.startsWith('dark matter')) {
    return '2024';
  }

  const isMonsterCartoonOrMovie = [
    'корпорация монстров', 'университет монстров', 'монстры на каникулах', 
    'монстры против пришельцев', 'миньоны и монстры', 'монстр траки', 'монстро'
  ].some(m => norm === m || norm.startsWith(m + ' ') || norm.includes(m));

  // 1. Проверка реестра подтверждённых дат (сортировка по убыванию длины ключа для исключения коллизий подстрок)
  if (/зв[её]здные\s+войны\s*:\s*видени[яе]|star\s+wars\s*:\s*visions/i.test(String(title || ''))) {
    return '2021';
  }
  const exactOnlyRoots = new Set([
    'звёздные войны', 'звездные войны', 'star wars', 'гарри поттер', 'harry potter',
    'властелин колец', 'аватар', 'avatar', 'матрица', 'терминатор', 'чужой', 'хищник',
    'тачки', 'шрек', 'ледниковый период', 'гадкий я', 'кунг-фу панда', 'история игрушек',
    'суперсемейка', 'бэтмен', 'супермен', 'человек-паук', 'мстители', 'тор', 'железный человек',
    'дюна', 'одиссея', 'кэрри', 'carrie', 'леон', 'начало', 'престиж', 'довод', 'прометей',
    'дракула', 'франкенштейн', 'обезьяна', 'балерина', 'гладиатор', 'носферату', 'фоллаут', 'fallout'
  ]);
  const sortedEntries = Object.entries(KNOWN_RELEASE_YEARS).sort((a, b) => b[0].length - a[0].length);
  for (const [knownTitle, yr] of sortedEntries) {
    const cleanKnown = knownTitle.replace(/ё/g, 'е');
    if (cleanKnown === 'монстры' || cleanKnown === 'монстр') {
      if (isMonsterCartoonOrMovie) continue;
      if (norm === cleanKnown || norm.startsWith(cleanKnown + ' ') || norm.startsWith(cleanKnown + ':')) {
        return yr;
      }
      continue;
    }
    if (exactOnlyRoots.has(cleanKnown) || exactOnlyRoots.has(knownTitle)) {
      if (norm === cleanKnown) return yr;
      continue;
    }
    if (norm === cleanKnown || norm.startsWith(cleanKnown + ' ') || norm.startsWith(cleanKnown + ':')) {
      return yr;
    }
  }

  // 2. Если уже есть корректный год (в диапазоне 1920-2030), сохраняем его
  if (existingYear) {
    const ym = String(existingYear).match(/\b(19\d\d|20\d\d)\b/);
    if (ym) {
      const parsed = parseInt(ym[1], 10);
      if (parsed >= 1920 && parsed <= 2030) return ym[1];
    }
  }

  // 3. Проверка даты премьеры / release_date
  if (dateStr) {
    const ym = String(dateStr).match(/\b(19\d\d|20\d\d)\b/);
    if (ym) {
      const parsed = parseInt(ym[1], 10);
      if (parsed >= 1920 && parsed <= 2030) return ym[1];
    }
  }

  // 4. Поиск года в названии (в скобках)
  const fullTitle = String(title || '');
  const bracketYear = fullTitle.match(/[\(\[]\s*(\d{4})\s*[\)\]]/);
  if (bracketYear) {
    const parsed = parseInt(bracketYear[1], 10);
    if (parsed >= 1920 && parsed <= 2030) return bracketYear[1];
  }

  // 5. Поиск года в URL (например: /4026-dzhek-richer-2022.html)
  const linkStr = String(link || '');
  if (linkStr) {
    const linkMatch = linkStr.match(/(?:-|_|\/|\b)(19\d\d|20\d\d)(?:\.html|\/|$)/);
    if (linkMatch) {
      const parsed = parseInt(linkMatch[1], 10);
      if (parsed >= 1920 && parsed <= 2030) return linkMatch[1];
    }
  }

  // 6. Поиск года по границам слов в названии (с защитой от 2049, 1984, 2012, 1917, 2001)
  const wordYear = fullTitle.match(/\b(19\d\d|20\d\d)\b/);
  if (wordYear) {
    const parsed = parseInt(wordYear[1], 10);
    if (parsed >= 1920 && parsed <= 2030 &&
        parsed !== 2049 && parsed !== 1984 && parsed !== 2012 && parsed !== 1917 && parsed !== 2001) {
      return wordYear[1];
    }
  }

  // 7. По умолчанию для свежего каталога в 2026 году
  return '2026';
}

/**
 * Интеллектуальное обогащение жанров
 * @returns {string[]} Массив жанров с большой буквы
 */
export function resolveCanonicalGenres(title = '', category = '', description = '', existingGenres = null) {
  const norm = normalizeTitle(title);

  const isMonsterCartoonOrMovie = [
    'корпорация монстров', 'университет монстров', 'монстры на каникулах', 
    'монстры против пришельцев', 'миньоны и монстры', 'монстр траки', 'монстро'
  ].some(m => norm === m || norm.startsWith(m + ' ') || norm.includes(m));

  // 1. Проверка канонической базы подтверждённых жанров (наивысший приоритет)
  for (const [knownTitle, genreList] of Object.entries(KNOWN_MEDIA_GENRES)) {
    if (knownTitle === 'монстры' || knownTitle === 'монстр') {
      if (isMonsterCartoonOrMovie) continue;
      if (norm === knownTitle || norm.startsWith(knownTitle + ' ') || norm.startsWith(knownTitle + ':')) {
        return [...genreList];
      }
      continue;
    }
    if (norm === knownTitle || norm.startsWith(knownTitle + ' ') || norm.includes(knownTitle)) {
      return [...genreList];
    }
  }

  const isExplicitSeries = !isMonsterCartoonOrMovie && (
    category === 'series' || category === 'serial' || category === 'Сериал' || category === 'сериал' ||
    norm === 'монстры' || norm.startsWith('монстры ') || norm.startsWith('монстры:') ||
    norm === 'монстр' || norm.startsWith('монстр ') || norm.startsWith('монстр:') ||
    norm.includes('менталист') || norm.includes('mentalist') ||
    norm.includes('дневники вампира') || norm.includes('vampire diaries') ||
    KNOWN_SERIES.some(s => norm === s || norm.startsWith(s + ' ') || norm.includes(s))
  );

  const isExplicitMovie = category === 'movies' || category === 'movie' || category === 'Фильм' || category === 'фильм';

  // 2. Если уже переданы структурированные жанры, нормализуем их
  let baseList = [];
  if (Array.isArray(existingGenres) && existingGenres.length > 0) {
    baseList = existingGenres.map(g => String(g).trim()).filter(Boolean);
  } else if (typeof existingGenres === 'string' && existingGenres.trim().length > 0) {
    baseList = existingGenres.split(/[,/|]/).map(g => g.trim()).filter(Boolean);
  }

  if (baseList.length > 0) {
    // Дедупликация и капитализация
    const set = new Set();
    baseList.forEach(g => {
      const clean = g.charAt(0).toUpperCase() + g.slice(1);
      if (clean && !clean.includes('undefined')) {
        if (isExplicitSeries && clean === 'Фильм') return;
        if (isExplicitMovie && clean === 'Сериал') return;
        set.add(clean);
      }
    });
    if (isExplicitSeries && !set.has('Сериал')) {
      set.add('Сериал');
    }
    const semanticGenres = Array.from(set).filter(g => g !== 'Сериал' && g !== 'Фильм');
    if (semanticGenres.length === 1) {
      const g0 = semanticGenres[0].toLowerCase();
      if (g0 === 'ужасы' || g0 === 'хоррор') {
        set.add('Триллер');
        set.add('Мистика');
      } else if (g0 === 'фантастика') {
        set.add('Боевик');
        set.add('Приключения');
      } else if (g0 === 'боевик') {
        set.add('Триллер');
        set.add('Приключения');
      } else if (g0 === 'триллер') {
        set.add('Детектив');
        set.add('Драма');
      } else if (g0 === 'комедия') {
        set.add('Приключения');
      } else if (g0 === 'драма') {
        set.add('Мелодрама');
      } else if (g0 === 'детектив' || g0 === 'криминал') {
        set.add('Триллер');
        set.add('Драма');
      } else if (g0 === 'фэнтези') {
        set.add('Приключения');
      }
    }
    if (set.size > 0) return Array.from(set);
  }

  // 3. Контекстный экстрактор по ключевым словам из описания, названия и категории
  const text = `${title} ${category} ${description}`.toLowerCase();
  const detected = new Set();

  const rules = [
    { tag: 'Аниме', patterns: [/аниме/i, /shikimori/i, /anilibria/i, /anixart/i, /манга/i] },
    { tag: 'Мультфильм', patterns: [/мультфильм/i, /мультсериал/i, /анимация/i, /pixar/i, /disney/i, /dreamworks/i] },
    { tag: 'Фантастика', patterns: [/фантастик/i, /sci-fi/i, /будуще/i, /космос/i, /планет/i, /инопланет/i, /киберпанк/i, /супероружи/i, /вселенн/i] },
    { tag: 'Боевик', patterns: [/боевик/i, /экшен/i, /стрельб/i, /спецназ/i, /агент/i, /битва/i, /сражен/i, /оружи/i] },
    { tag: 'Комедия', patterns: [/комеди/i, /юмор/i, /смеш/i, /забавн/i, /ситком/i] },
    { tag: 'Триллер', patterns: [/триллер/i, /напряжен/i, /маньяк/i, /преследован/i, /опасн/i, /заговор/i] },
    { tag: 'Драма', patterns: [/драма/i, /трагеди/i, /судьб/i, /чувств/i, /переживан/i] },
    { tag: 'Детектив', patterns: [/детектив/i, /расследован/i, /убийств/i, /сыщик/i, /полици/i, /тайн/i, /загадк/i] },
    { tag: 'Криминал', patterns: [/криминал/i, /мафи/i, /гангстер/i, /бандит/i, /преступн/i, /ограблен/i] },
    { tag: 'Ужасы', patterns: [/ужас/i, /хоррор/i, /кошмар/i, /монстр/i, /зомби/i, /призрак/i] },
    { tag: 'Фэнтези', patterns: [/фэнтези/i, /маги/i, /волшеб/i, /дракон/i, /эльф/i, /заклинани/i, /рыцар/i] },
    { tag: 'Приключения', patterns: [/приключен/i, /путешеств/i, /поход/i, /экспедици/i, /поиск/i] },
    { tag: 'Семейный', patterns: [/семейн/i, /детск/i, /детям/i, /родител/i] },
    { tag: 'Мелодрама', patterns: [/мелодрам/i, /любов/i, /романтик/i, /отношени/i] },
    { tag: 'История', patterns: [/историческ/i, /истори/i, /древн/i, /эпох/i, /импери/i, /век/i] },
    { tag: 'Военный', patterns: [/военн/i, /войн/i, /солдат/i, /арми/i, /фронт/i, /сражени/i] },
    { tag: 'Биография', patterns: [/биографи/i, /реальн.*событи/i, /основан.*на.*истори/i] },
    { tag: 'Документальный', patterns: [/документальн/i, /хроник/i] }
  ];

  for (const r of rules) {
    if (r.patterns.some(p => p.test(text))) {
      detected.add(r.tag);
    }
  }

  if (isExplicitSeries) {
    detected.delete('Фильм');
    detected.add('Сериал');
  }
  if (isExplicitMovie) {
    detected.delete('Сериал');
    detected.add('Фильм');
  }

  if (detected.size === 0) {
    if (category === 'cartoons' || category === 'cartoon-series') return ['Мультфильм', 'Семейный'];
    if (category === 'anime' || category === 'anime-series' || category === 'anime-movies') return ['Аниме', 'Приключения'];
    if (category === 'series' || isExplicitSeries) return ['Сериал', 'Драма'];
    return ['Фильм', 'Приключения'];
  }

  return Array.from(detected).slice(0, 4);
}

/**
 * Комплексная проверка медиа-объекта на принадлежность к трейлерам, тизерам, промо и фанатским концептам.
 * Гарантирует 100% исключение любого рекламного, промо и незавершенного фанатского контента во всех каталогах и поиске.
 */
export function isTrailerMedia(item) {
  if (!item) return false;
  if (typeof item === 'object') {
    if (item.is_trailer) return true;
    if (item.quality && /трейлер/i.test(String(item.quality))) return true;
    if (/клэйфейс|clayface/i.test(String(item.title || '') + ' ' + String(item.original_title || ''))) return true;
  }

  const title = typeof item === 'string' ? item : (item.title || item.name || '');
  const originalTitle = typeof item === 'string' ? '' : (item.original_title || item.original_name || '');
  const description = typeof item === 'string' ? '' : (item.description || item.overview || '');
  const category = typeof item === 'string' ? '' : (item.category || '');
  const genres = Array.isArray(item.genres) ? item.genres.join(' ') : String(item.genres || '');
  const durationSec = parseInt(item.duration_seconds || item.durationSec || item.duration || 0, 10);
  const source = item.source || '';

  const cleanTitle = title.trim();
  const cleanOriginalTitle = originalTitle.trim();
  const combinedText = `${cleanTitle} ${cleanOriginalTitle} ${category} ${genres}`.toLowerCase();

  // 1. Прямые маркеры трейлеров и промо в названии или категории
  const trailerWordsRegex = /\b(трейлер[а-я]*|тизер[а-я]*|тизер-трейлер[а-я]*|тизерная|trailer[s]?|teaser[s]?|промо[- ]ролик[а-я]*|отрывок|фрагмент[а-я]*|бэкстейдж|backstage|making[- ]of|создание\s+фильма|как\s+создавался|история\s+создания|фильм\s+о\s+фильме|съемки|съёмки|клип[а-я]*|музыкальный[- ]клип[а-я]*|саундтрек|sneak[- ]peek|first[- ]look|featurette|фан[- ]трейлер[а-я]*|fan[- ]trailer[s]?|концепт[- ]трейлер[а-я]*|concept[- ]trailer[s]?)\b/i;

  if (trailerWordsRegex.test(cleanTitle) || trailerWordsRegex.test(cleanOriginalTitle) || trailerWordsRegex.test(category)) {
    return true;
  }

  // Маркеры в скобках, дефисах или составных фразах
  const subPatterns = [
    'трейлер', 'тизер', 'trailer', 'teaser',
    'промо-ролик', 'промо ролик', 'официальный трейлер', 'русский трейлер',
    'дублированный трейлер', 'финальный трейлер', 'тизер-трейлер', 'концепт-трейлер',
    'concept trailer', 'fan trailer', 'фан-трейлер', 'фан трейлер',
    'создание фильма', 'как создавался', 'история создания', 'фильм о фильме', 'making of',
    'обзор сериала', 'обзор фильма', 'обзор премьеры', 'разбор сериала', 'разбор фильма',
    'разбор концовки', 'разбор сюжета', 'лекция для сна', 'для сна', 'дата выхода',
    'когда выйдет', 'что известно', 'расписание выхода', 'простыми словами',
    'семихатов', 'сурдин', 'горбунов', 'постнаука', 'научпоп', 'visual facts',
    'откуда мы знаем', 'до сих пор никто не понимает', 'которую мы не видим',
    'нерешенных проблем', 'нерешённых проблем', 'теория всего', 'теория струн',
    'дмитрий вибе', 'черные дыры и темная материя', 'темная эпоха вселенной',
    'темная материя пронзает нас', 'пронзает нас'
  ];
  for (const p of subPatterns) {
    if (combinedText.includes(p)) {
      return true;
    }
  }

  // Обзоры, разборы, лекции и вопросы в начале названия
  if (/^(?:создание фильма|как создавался|история создания|фильм о фильме|обзор|разбор|пересказ|рекап|сюжет|подробный разбор|честный обзор|лекция|доклад|что такое|почему|как устроена|как работает|в чем разница|95% вселенной)\b/i.test(cleanTitle)) {
    return true;
  }

  // 2. Фанатские концепт-трейлеры несуществующих фильмов (например фейковый Человек-паук: Новый день)
  const normTitle = cleanTitle.toLowerCase().replace(/[^a-zа-яё0-9]/gi, ' ').replace(/\s+/g, ' ').trim();
  const normOriginal = cleanOriginalTitle.toLowerCase().replace(/[^a-zа-яё0-9]/gi, ' ').replace(/\s+/g, ' ').trim();
  const hasSpiderman = normTitle.includes('человек паук') || normTitle.includes('spider man') || normOriginal.includes('spider man');
  const hasNewDay = normTitle.includes('новый день') || normTitle.includes('brand new day') || normTitle.includes('a new day') || normOriginal.includes('brand new day') || normOriginal.includes('a new day');
  if (hasSpiderman && hasNewDay) {
    return true;
  }
  if (
    normTitle.includes('человек паук новый день') ||
    normTitle.includes('человек паук 4 новый день') ||
    normTitle.includes('spider man brand new day') ||
    normTitle.includes('spider man a new day') ||
    normTitle.includes('spider man 4 new day') ||
    normOriginal.includes('brand new day') ||
    normOriginal.includes('a new day')
  ) {
    return true;
  }

  // 2.5 Игрофильмы, прохождения игр и геймплей-ролики
  const author = (typeof item.author === 'string' ? item.author : '').toLowerCase();
  const gameFootagePatterns = ['игрофильм', 'игро фильм', 'геймплей', 'gameplay', 'walkthrough', 'прохождение игры', 'прохождение без комментариев', 'летсплей', 'letsplay'];
  for (const gp of gameFootagePatterns) {
    if (combinedText.includes(gp) || author.includes(gp)) {
      return true;
    }
  }
  if ((source === 'rutube' || source === 'vkvideo') && genres.toLowerCase().includes('видеоигры')) {
    return true;
  }

  // 3. Проверка длительности для RuTube и VK Видео: видео короче 10 минут (600 сек), позиционируемое как фильм
  if ((source === 'rutube' || source === 'vkvideo') && durationSec > 0 && durationSec < 600) {
    const isEpisode = /сери|сезон|эпизод|выпуск/i.test(cleanTitle);
    if (!isEpisode) {
      return true;
    }
  }

  // 4. Описание, указывающее на промо-материал или трейлер
  if (description) {
    const descLower = description.toLowerCase();
    if (
      descLower.startsWith('трейлер') ||
      descLower.startsWith('тизер') ||
      descLower.startsWith('официальный трейлер') ||
      descLower.startsWith('русский трейлер') ||
      descLower.startsWith('дублированный трейлер') ||
      /\b(смотреть трейлер|смотрите трейлер|официальный дублированный трейлер|главный трейлер|тизер-трейлер)\b/i.test(descLower)
    ) {
      if (durationSec > 0 && durationSec < 900) return true;
      if (descLower.length < 220 && (descLower.includes('трейлер') || descLower.includes('тизер'))) return true;
    }
  }

  return false;
}

export function resolveCanonicalSeriesSeasonsCount(title = '') {
  const norm = normalizeTitle(title).replace(/ё/g, 'е');
  for (const [k, v] of Object.entries(KNOWN_SERIES_SEASONS)) {
    if (norm === k || norm.startsWith(k + ' ') || norm.includes(k)) return v;
  }
  return null;
}

// Тайтлы, где число в конце является частью канонического названия франшизы (не номером сезона)
const PROTECTED_NUMBER_TITLES = [
  'кайдзю номер 8', 'кайдзю №8', 'кайдзю № 8', 'kaiju no. 8', 'kaiju no 8',
  'моб психо 100', 'mob psycho 100',
  '86', 'восемьдесят шесть', 'eighty six', 'eighty-six',
  'зона 88', 'area 88',
  'токио 24-й район', 'tokyo 24th ward',
  'гандам 00', 'gundam 00',
  'вавилон 5', 'babylon 5',
  '1984', '2012', '1917', '9', '300', '24'
];

export function extractSeasonNumberFromTitle(rawTitle = '') {
  if (!rawTitle) return 1;
  const s = String(rawTitle).trim();
  if (/(?:зв[её]здные\s+войны\s*:\s*видени[яе]|star\s+wars\s*:\s*visions).*(?:девятый\s+джедай|ninth\s+jedi)/i.test(s)) {
    return 4;
  }
  const mExplicit = s.match(/(?:\[|\(|\b)(?:тв|tv)[\s-]*(\d{1,2})(?:\]|\)|\b)/i)
    || s.match(/(\d{1,2})\s*(?:-?[йяе]|ый|ой)?\s*сезон/i)
    || s.match(/сезон\s*(\d{1,2})/i)
    || s.match(/\bseason\s*(\d{1,2})\b/i)
    || s.match(/\bvolume\s*(\d{1,2})\b/i)
    || s.match(/\b(\d{1,2})(?:nd|rd|th)\s+season\b/i);
  if (mExplicit) {
    const n = parseInt(mExplicit[1], 10);
    if (n >= 1 && n <= 20) return n;
  }
  const mTrail = s.match(/^(.+?)\s+([2-9]|1[0-2])(?:\s*[:.\-–—]\s*.+)?$/);
  if (mTrail) {
    const candidateFull = s.toLowerCase().replace(/ё/g, 'е').trim();
    if (!PROTECTED_NUMBER_TITLES.includes(candidateFull)) {
      return parseInt(mTrail[2], 10) || 1;
    }
  }
  return 1;
}

export function normalizeAnimeFranchiseTitle(rawTitle = '', isAnimeOrSeries = true) {
  if (!rawTitle) return '';
  let s = String(rawTitle).trim();

  // Удаляем пометки качества и постеров
  s = s.replace(/\s*постер\s*4[\u004B\u006B\u041A\u043A]/gi, '');
  s = s.replace(/\s*постер/gi, '');
  s = s.replace(/\s*[\(\[]\s*(?:4[\u004B\u006B\u041A\u043A]|Ultra\s*HD|UHD|2160p|1080p|720p|480p|HDR10\+?|HDR|Dolby\s*Vision|BDRip|WEB-DL|Remux).*?[\)\]]/gi, '');

  // Каноническое объединение франшизы «Звёздные Войны: Видения» (включая спин-офф/сезон «Девятый джедай»)
  if (/^зв[её]здные\s+войны\s*:\s*видени[яе]/i.test(s)) {
    return 'Звёздные Войны: Видения';
  }
  if (/^star\s+wars\s*:\s*visions/i.test(s)) {
    return 'Star Wars: Visions';
  }

  if (!isAnimeOrSeries) {
    return s.replace(/\s{2,}/g, ' ').trim();
  }

  // 1. Удаляем явные пометки сезона/части в скобках и без скобок: [ТВ-2], (2 сезон), Season 2, 2nd Season, Часть 2, Part 2
  s = s.replace(/\s*[\(\[]\s*(?:(?:тв|tv)[\s-]*\d+(?:\s*часть\s*\d+)?|\d+\s*(?:-?[йяе]|ый|ой)?\s*сезон|сезон\s*\d+|season\s*\d+|\d+(?:nd|rd|th)\s*season|часть\s*\d+|part\s*\d+|cour\s*\d+|арка\s*[^\)\]]+)\s*[\)\]]/gi, '');
  s = s.replace(/(?:\s*[:.\-–—/|•]\s*|\s+)(?:(?:тв|tv)[\s-]*\d+|\d+\s*(?:-?[йяе]|ый|ой)?\s*сезон|сезон\s*\d+|season\s*\d+|\d+(?:nd|rd|th)\s+season)(?:\s*[:.\-–—/|•].*)?$/gi, '');
  s = s.replace(/(?:\s*[:.\-–—/|•]\s*|\s+)(?:часть|part|cour)\s*\d+$/gi, '');
  s = s.replace(/\s+x([2-5])$/gi, '');

  // 2. Проверяем защищённые названия с числом, после которых идёт ещё одна цифра сезона (например: "Кайдзю номер 8 2" -> "Кайдзю номер 8")
  const lowerClean = s.toLowerCase().replace(/ё/g, 'е').trim();
  for (const prot of PROTECTED_NUMBER_TITLES) {
    if (lowerClean === prot) {
      return s.replace(/\s{2,}/g, ' ').trim();
    }
    const protRegex = new RegExp(`^(${prot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\s+(?:[2-9]|1[0-2])(?:\s*[:.\-–—].*)?$`, 'i');
    const mProt = s.match(protRegex);
    if (mProt) {
      return mProt[1].trim();
    }
  }

  // 3. Удаляем хвостовой номер сезона вида "Киберпанк: Бегущие по краю 2", "Cyberpunk: Edgerunners 2", "Гроб принцессы Чайки 2: Битва..."
  const mSeasonSuffix = s.match(/^(.{3,}?)\s+([2-9]|1[0-2])(?:\s*[:.\-–—]\s*(?:часть|part|сезон|season|арка|битва|во\s+имя|пробуждение|восстание|финал).*)?$/i);
  if (mSeasonSuffix) {
    const basePart = mSeasonSuffix[1].trim();
    const fullLower = s.toLowerCase().replace(/ё/g, 'е').trim();
    if (!PROTECTED_NUMBER_TITLES.includes(fullLower) && basePart.length >= 2) {
      s = basePart;
    }
  }

  s = s.replace(/[-–—/|•:]\s*$/, '').trim();
  return s.replace(/\s{2,}/g, ' ').trim();
}


// ==========================================
// КАНОНИЧЕСКИЙ ДЕТЕКТОР ОЖИДАЕМЫХ РЕЛИЗОВ (UPCOMING / AWAITING DIGITAL RELEASE)
// ==========================================
const KNOWN_UNRELEASED_TMDB_IDS = new Set([
  '791523', '1477104', '1465063', '1153576', '1742441', '1236045', '1400837',
  '1101412', '1148365', '1423191', '1281331', '1302904', '1248832', '1232569',
  '1255833', '1561726', '1765072', '1288069', '1802674', '947493', '1788735',
  '1777750', '1599191', '1750432', '1764166', '1760194', '1666700', '1572116',
  '1729723', '1187326', '1732625', '1630030', '1679730', '1748007', '1418998',
  '1623256', '1438966', '1241803', '1234139', '848700', '1790935', '1487317',
  '1412795', '1429592', '1381078', '1058424', '1228834', '1514026', '1377237',
  '1284186', '1503762', '1757506', '1283515', '1556321', '1388805', '1769556',
  '1244523', '1763332', '1768117', '1763619', '1650896', '1767731', '1269325',
  '1596303', '1766421', '1640396', '1618090', '1634905', '1768911', '1559680',
  '1447963', '1590909', '1336068', '1375156', '718833', '1496785', '1754879',
  '1443151', '1767115', '1768359', '1768029'
]);

const KNOWN_UNRELEASED_TITLE_PATTERNS = [
  /ведьмин\s+лес|\bwildwood\b/i,
  /барашек\s+шон\s+и\s+чудище|beast\s+of\s+mossy\s+bottom/i,
  /остров\s+забвения|\bforgotten\s+island\b/i,
  /кэрри.*2026|\bcarrie\b.*flanagan/i,
  /одиссея.*2026|\bthe\s+odyssey\b/i,
  /история\s+игрушек\s*5|\btoy\s+story\s*5\b/i,
  /мстители\s*:\s*судный\s+день|\bavengers\s*:\s*doomsday\b/i,
  /человек[- ]паук\s*:\s*новый\s+день|\bspider[- ]man\s*:\s*brand\s+new\s+day\b/i,
  /шрек\s*5|\bshrek\s*5\b/i,
  /ледниковый\s+период\s*6|\bice\s+age\s*6\b/i,
  /бэтмен\s*:\s*часть\s*2|\bthe\s+batman\s+part\s+ii\b/i,
  /мандалорец\s+и\s+грогу|\bmandalorian\s+and\s+grogu\b/i,
  /чужая\s+мама|\bother\s+mommy\b/i,
  /вышка\s*2|\bfall\s*2\s*:\s*deadpoint\b/i,
  /matchbox\s*:\s*фильм|\bmatchbox\s+the\s+movie\b/i,
  /социальная\s+расплата|\bthe\s+social\s+reckoning\b/i,
  /практическая\s+магия\s*2|\bpractical\s+magic\s*2\b/i,
  /пиноккио\s*:\s*раскрепощ[её]нный|\bpinocchio\s*:\s*unstrung\b/i,
  /кит\s*:\s*во\s+тьме\s+глубин|\bwhalefall\b/i,
  /з\/л\/о\s*:\s*сборник|\bv\/h\/s\/mixtape\b/i
];

export function isMediaUpcomingOrUnreleased(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.is_upcoming === true || item.isUpcoming === true) return true;

  const rawId = String(item.id || item.tmdb_id || '').trim();
  if (rawId.startsWith('tmdb_up_')) return true;

  const cleanTmdbId = rawId.replace(/^tmdb_(?:up_|movie_|tv_|series_)?/i, '');
  if (cleanTmdbId && KNOWN_UNRELEASED_TMDB_IDS.has(cleanTmdbId)) {
    return true;
  }

  const titleCombo = `${item.title || ''} ${item.original_title || ''} ${item.name || ''}`.trim();
  if (titleCombo && KNOWN_UNRELEASED_TITLE_PATTERNS.some(rx => rx.test(titleCombo))) {
    return true;
  }

  if (item.status && ['planned', 'in production', 'post production', 'rumored', 'upcoming'].includes(String(item.status).toLowerCase())) {
    return true;
  }
  if (item.quality && /ожидается|скоро|анонс/i.test(String(item.quality))) {
    return true;
  }
  if (item.premiere && /ожидается|скоро|в кино|анонс/i.test(String(item.premiere))) {
    return true;
  }

  const hasVerifiedDirectStream = Boolean(
    (item.fanfilm_4k_url && !String(item.fanfilm_4k_url).includes('do=search')) ||
    item.fanfilm_hd_url ||
    item.lift_id ||
    item.vk_embed_url ||
    (item.rutube_id && String(item.rutube_id).length > 15) ||
    item.source === 'fanfilm4k' ||
    item.source === 'lift' ||
    item.source === 'anilibria' ||
    item.source === 'anixart'
  );

  const yr = parseInt(item.year, 10) || 0;
  if (yr > 2026 && !hasVerifiedDirectStream) {
    return true;
  }

  const dateCandidates = [item.release_date, item.premiere, item.digital_release, item.world_premier].filter(Boolean);
  for (const rawD of dateCandidates) {
    const s = String(rawD).trim();
    let parsedDate = null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      if (s !== `${yr}-01-01`) {
        parsedDate = new Date(s.substring(0, 10));
      }
    } else if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
      const [dd, mm, yyyy] = s.split('.');
      parsedDate = new Date(`${yyyy}-${mm}-${dd}`);
    }
    if (parsedDate && !isNaN(parsedDate.getTime())) {
      if (parsedDate > new Date()) return true;
      if (!hasVerifiedDirectStream && parsedDate >= new Date('2026-04-15')) {
        return true;
      }
    }
  }

  if (!hasVerifiedDirectStream && (item.source === 'tmdb' || rawId.startsWith('tmdb_')) && yr >= 2026) {
    const votes = parseInt(item.vote_count, 10) || 0;
    if (votes > 0 && votes < 180) {
      return true;
    }
  }

  return false;
}
