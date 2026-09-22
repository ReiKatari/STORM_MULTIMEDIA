import { db } from "../db.js";

export const VERIFIED_CATALOG_FALLBACK = {
  "popular": [
    {
      "id": "rutube_landyshi",
      "title": "Ландыши",
      "original_title": "Ландыши. Такая нежная любовь",
      "poster": "https://pic.rtbcdn.ru/video/2025-01-13/bc/9f/bc9fda6d31c72a8002c8999542e877ab.jpg",
      "year": "2025–2026",
      "rating": 8.5,
      "quality": "1080p FHD",
      "is4K": false,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Мелодрама",
        "Драма",
        "Музыка"
      ],
      "source": "rutube",
      "rutube_id": "564f31c881b83373bfe0cb26979d44cf",
      "embed_url": "https://rutube.ru/play/embed/564f31c881b83373bfe0cb26979d44cf",
      "video_url": "https://rutube.ru/video/564f31c881b83373bfe0cb26979d44cf/",
      "total_episodes": 16,
      "seasons": 2,
      "description": "Популярная музыкальная мелодрама Wink о Кате Орловой и Лехе Данилине: любовь, распад группы, интриги и борьба за наследство."
    },
    {
      "id": "82529",
      "title": "Человек-паук: Новый день",
      "original_title": "Spider-Man: Brand New Day",
      "poster": "https://image.tmdb.org/t/p/w500/pK8CH9JxrgX2ZIq3WclTwnX0cCL.jpg",
      "year": "2026",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Фантастика",
        "Боевик",
        "Приключения"
      ],
      "source": "fanfilm4k",
      "url": "https://v17.fanfilm4k.media/82529-chelovek-pauk-novyj-den-film.html",
      "description": "Питер Паркер сталкивается с последствиями стертой памяти мира и новыми угрозами Нью-Йорка в новой эре."
    },
    {
      "id": "tmdb_dune2",
      "title": "Дюна: Часть вторая",
      "original_title": "Dune: Part Two",
      "poster": "https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg",
      "year": "2024",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Фантастика",
        "Приключения",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Пол Атрейдес объединяется с Чани и фременами, чтобы отомстить заговорщикам, уничтожившим его семью."
    },
    {
      "id": "lostfilm_penguin",
      "title": "Пингвин",
      "original_title": "The Penguin",
      "poster": "https://image.tmdb.org/t/p/w500/25dj85s5VtirRWF6rmO8TpZXHJV.jpg",
      "year": "2024",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Криминал",
        "Драма"
      ],
      "source": "lostfilm",
      "description": "Освальд Кобблпот стремится захватить власть в криминальном мире Готэма после событий фильма «Бэтмен»."
    },
    {
      "id": "tmdb_deadpool_wolverine",
      "title": "Дэдпул и Росомаха",
      "original_title": "Deadpool & Wolverine",
      "poster": "https://image.tmdb.org/t/p/w500/4Li3gy8Ga6q0bAz2odg7ZFoRqLy.jpg",
      "year": "2024",
      "rating": 8.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Комедия",
        "Фантастика"
      ],
      "source": "tmdb",
      "description": "Уэйд Уилсон объединяется с угрюмым Росомахой из альтернативной вселенной для спасения мультивселенной."
    },
    {
      "id": "lostfilm_shogun",
      "title": "Сёгун",
      "original_title": "Shōgun",
      "poster": "https://image.tmdb.org/t/p/w500/cOKLRblbdBtcuf4TkAzsyJpZr23.jpg",
      "year": "2024",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Драма",
        "История",
        "Военный"
      ],
      "source": "lostfilm",
      "description": "В Японии начала XVII века английский штурман Джон Блэкторн оказывается втянут в смертельную борьбу феодальных кланов."
    },
    {
      "id": "rhs_arcane2",
      "title": "Аркейн (2 сезон)",
      "original_title": "Arcane Season 2",
      "poster": "https://image.tmdb.org/t/p/w500/kVioUjk1SXGWblJNaKsIJcBqUcY.jpg",
      "year": "2024",
      "rating": 9.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Фантастика",
        "Боевик",
        "Драма"
      ],
      "source": "redheadsound",
      "description": "Кульминация противостояния городов-близнецов Пилтовера и Зауна и сестер Вай и Джинкс."
    },
    {
      "id": "lostfilm_fallout",
      "title": "Фоллаут",
      "original_title": "Fallout",
      "poster": "https://image.tmdb.org/t/p/w500/7o3XRf31lEtAaRNtgupOGTDD3sP.jpg",
      "year": "2024",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Фантастика",
        "Приключения",
        "Боевик"
      ],
      "source": "lostfilm",
      "description": "Выходцы из безопасных подземных Убежищ сталкиваются с жестоким и причудливым миром постапокалиптической Пустоши."
    },
    {
      "id": "tmdb_wild_robot",
      "title": "Дикий робот",
      "original_title": "The Wild Robot",
      "poster": "https://image.tmdb.org/t/p/w500/sDTumQBxhIyYbZ9acsTtoLfb5ZG.jpg",
      "year": "2024",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Фантастика",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "Робот ROZZUM 7134 терпит крушение на необитаемом острове и учится дружить с дикими животными."
    },
    {
      "id": "anilibria_solo_leveling2",
      "title": "Поднятие уровня в одиночку",
      "original_title": "Solo Leveling",
      "poster": "https://image.tmdb.org/t/p/w500/8u56LKz0An8xa9YaFtkxsDKc5N5.jpg",
      "year": "2025",
      "rating": 8.6,
      "quality": "1080p FHD",
      "is4K": false,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Боевик",
        "Фэнтези"
      ],
      "source": "anilibria",
      "description": "Путь слабейшего охотника человечества к вершине могущества."
    },
    {
      "id": "tmdb_gladiator2",
      "title": "Гладиатор 2",
      "original_title": "Gladiator II",
      "poster": "https://image.tmdb.org/t/p/w500/6N7F1Ga9m0CTHziA2Fs7BQczaKZ.jpg",
      "year": "2024",
      "rating": 7.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Приключения",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Спустя годы после гибели Максимуса повзрослевший Луций вынужден выйти на арену Колизея во имя свободы Рима."
    },
    {
      "id": "tmdb_oppenheimer",
      "title": "Оппенгеймер",
      "original_title": "Oppenheimer",
      "poster": "https://image.tmdb.org/t/p/w500/8OQzw8keE6sDNH25sOqPRTxhFTO.jpg",
      "year": "2023",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Драма",
        "История",
        "Биография"
      ],
      "source": "tmdb",
      "description": "История жизни американского физика Роберта Оппенгеймера и создания первой атомной бомбы."
    },
    {
      "id": "lostfilm_gentlemen",
      "title": "Джентльмены",
      "original_title": "The Gentlemen",
      "poster": "https://image.tmdb.org/t/p/w500/bpy9uaV0oOlKnEoPzodwrSSUFXg.jpg",
      "year": "2024",
      "rating": 8.2,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Криминал",
        "Комедия",
        "Боевик"
      ],
      "source": "lostfilm",
      "description": "Эдди Холстед наследует крупное поместье отца и неожиданно узнает, что оно является частью масштабной каннабис-империи."
    },
    {
      "id": "tmdb_interstellar",
      "title": "Интерстеллар",
      "original_title": "Interstellar",
      "poster": "https://image.tmdb.org/t/p/w500/vReLRjDV9XPhiOSEW7QWow4DXwf.jpg",
      "year": "2014",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Фантастика",
        "Драма",
        "Приключения"
      ],
      "source": "tmdb",
      "description": "Команда исследователей отправляется сквозь червоточину в поисках нового дома для человечества."
    },
    {
      "id": "lostfilm_the_boys",
      "title": "Пацаны",
      "original_title": "The Boys",
      "poster": "https://image.tmdb.org/t/p/w500/3NqlBDpWI83TgQ9nmeFwTVxEmtZ.jpg",
      "year": "2024",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Боевик",
        "Фантастика",
        "Комедия"
      ],
      "source": "lostfilm",
      "description": "Отряд мстителей противостоит зарвавшимся корпоративным супергероям с сомнительной моралью."
    },
    {
      "id": "tmdb_inside_out_2",
      "title": "Головоломка 2",
      "original_title": "Inside Out 2",
      "poster": "https://image.tmdb.org/t/p/w500/5fXrqBIvatwSuph7nTuSETBQYxm.jpg",
      "year": "2024",
      "rating": 8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Комедия",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "В голове взрослеющей Райли появляются новые эмоции — Тревожность, Зависть, Стыд и Хандра."
    },
    {
      "id": "anilibria_demon_slayer",
      "title": "Клинок, рассекающий демонов",
      "original_title": "Kimetsu no Yaiba",
      "poster": "https://image.tmdb.org/t/p/w500/zg3GrU3jAoTGxmlGGhkfNYMOHlb.jpg",
      "year": "2024",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Боевик",
        "Сёнэн"
      ],
      "source": "anilibria",
      "description": "Танджиро Камадо сражается с высшими демонами ради исцеления своей сестры."
    },
    {
      "id": "tmdb_substance",
      "title": "Субстанция",
      "original_title": "The Substance",
      "poster": "https://image.tmdb.org/t/p/w500/lqoMzCcZYEFK729Fc6r0pfz0Fio.jpg",
      "year": "2024",
      "rating": 8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Ужасы",
        "Драма",
        "Фантастика"
      ],
      "source": "tmdb",
      "description": "Угасающая голливудская звезда принимает экспериментальный препарат, порождающий ее молодую и совершенную версию."
    },
    {
      "id": "lostfilm_breaking_bad",
      "title": "Во все тяжкие",
      "original_title": "Breaking Bad",
      "poster": "https://image.tmdb.org/t/p/w500/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg",
      "year": "2008",
      "rating": 9.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Драма",
        "Криминал",
        "Триллер"
      ],
      "source": "lostfilm",
      "description": "Смертельно больной школьный учитель химии Уолтер Уайт начинает варить кристаллический метамфетамин."
    },
    {
      "id": "anilibria_attack_on_titan",
      "title": "Атака титанов",
      "original_title": "Shingeki no Kyojin",
      "poster": "https://image.tmdb.org/t/p/w500/9whSxgqSW7dPIIMJyM4WG3BYVo7.jpg",
      "year": "2023",
      "rating": 9.2,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Драма",
        "Боевик"
      ],
      "source": "anixart",
      "description": "Эпическая борьба остатков человечества за свободу против гигантских титанов."
    },
    {
      "id": "fanfilm_rick_morty",
      "title": "Рик и Морти",
      "original_title": "Rick and Morty",
      "poster": "https://image.tmdb.org/t/p/w500/6D1NA4IMUFI8lBNuCBUlp7eLYDP.jpg",
      "year": "2023",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Комедия",
        "Фантастика",
        "Приключения"
      ],
      "source": "fanfilm4k",
      "description": "Безумные межгалактические приключения дедушки-гения и его неуверенного внука."
    },
    {
      "id": "tmdb_dark_knight",
      "title": "Тёмный рыцарь",
      "original_title": "The Dark Knight",
      "poster": "https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
      "year": "2008",
      "rating": 9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Криминал",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Бэтмен поднимает ставки в войне с криминалом Готэма, когда на арену выходит гений хаоса — Джокер."
    },
    {
      "id": "tmdb_spider_verse",
      "title": "Человек-паук: Паутина вселенных",
      "original_title": "Spider-Man: Across the Spider-Verse",
      "poster": "https://image.tmdb.org/t/p/w500/wH0kbTvbrvtlCygso7Ye2ZfGfM1.jpg",
      "year": "2023",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Боевик",
        "Приключения"
      ],
      "source": "tmdb",
      "description": "Майлз Моралес отправляется в путешествие по мультивселенной, где сталкивается с Обществом пауков."
    },
    {
      "id": "shiki_boy_heron",
      "title": "Мальчик и птица",
      "original_title": "Kimitachi wa Dou Ikiru ka",
      "poster": "https://image.tmdb.org/t/p/w500/oTmSnrE9MuQMhZkosZRE5bYvstK.jpg",
      "year": "2023",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Приключения",
        "Фэнтези"
      ],
      "source": "shikimori",
      "description": "Оскароносная анимационная картина Хаяо Миядзаки о путешествии в волшебный мир."
    },
    {
      "id": "shiki_your_name",
      "title": "Твоё имя",
      "original_title": "Kimi no Na wa.",
      "poster": "https://image.tmdb.org/t/p/w500/iH2WDCYLIUjc7oPWRT7Kxgxza6k.jpg",
      "year": "2016",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Романтика",
        "Драма"
      ],
      "source": "shikimori",
      "description": "Шедевр Макото Синкая о связи двух душ сквозь время и пространство."
    }
  ],
  "new": [
    {
      "id": "82529",
      "title": "Человек-паук: Новый день",
      "original_title": "Spider-Man: Brand New Day",
      "poster": "https://image.tmdb.org/t/p/w500/pK8CH9JxrgX2ZIq3WclTwnX0cCL.jpg",
      "year": "2026",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Фантастика",
        "Боевик",
        "Приключения"
      ],
      "source": "fanfilm4k",
      "url": "https://v17.fanfilm4k.media/82529-chelovek-pauk-novyj-den-film.html",
      "description": "Питер Паркер сталкивается с последствиями стертой памяти мира и новыми угрозами Нью-Йорка в новой эре."
    },
    {
      "id": "lostfilm_gentlemen",
      "title": "Джентльмены",
      "original_title": "The Gentlemen",
      "poster": "https://image.tmdb.org/t/p/w500/bpy9uaV0oOlKnEoPzodwrSSUFXg.jpg",
      "year": "2024",
      "rating": 8.2,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Криминал",
        "Комедия",
        "Боевик"
      ],
      "source": "lostfilm",
      "description": "Эдди Холстед наследует крупное поместье отца и неожиданно узнает, что оно является частью масштабной каннабис-империи."
    },
    {
      "id": "tmdb_dune2",
      "title": "Дюна: Часть вторая",
      "original_title": "Dune: Part Two",
      "poster": "https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg",
      "year": "2024",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Фантастика",
        "Приключения",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Пол Атрейдес объединяется с Чани и фременами, чтобы отомстить заговорщикам, уничтожившим его семью."
    },
    {
      "id": "lostfilm_penguin",
      "title": "Пингвин",
      "original_title": "The Penguin",
      "poster": "https://image.tmdb.org/t/p/w500/25dj85s5VtirRWF6rmO8TpZXHJV.jpg",
      "year": "2024",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Криминал",
        "Драма"
      ],
      "source": "lostfilm",
      "description": "Освальд Кобблпот стремится захватить власть в криминальном мире Готэма после событий фильма «Бэтмен»."
    },
    {
      "id": "tmdb_gladiator2",
      "title": "Гладиатор 2",
      "original_title": "Gladiator II",
      "poster": "https://image.tmdb.org/t/p/w500/6N7F1Ga9m0CTHziA2Fs7BQczaKZ.jpg",
      "year": "2024",
      "rating": 7.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Приключения",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Спустя годы после гибели Максимуса повзрослевший Луций вынужден выйти на арену Колизея во имя свободы Рима."
    },
    {
      "id": "lostfilm_shogun",
      "title": "Сёгун",
      "original_title": "Shōgun",
      "poster": "https://image.tmdb.org/t/p/w500/cOKLRblbdBtcuf4TkAzsyJpZr23.jpg",
      "year": "2024",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Драма",
        "История",
        "Военный"
      ],
      "source": "lostfilm",
      "description": "В Японии начала XVII века английский штурман Джон Блэкторн оказывается втянут в смертельную борьбу феодальных кланов."
    },
    {
      "id": "rhs_arcane2",
      "title": "Аркейн (2 сезон)",
      "original_title": "Arcane Season 2",
      "poster": "https://image.tmdb.org/t/p/w500/kVioUjk1SXGWblJNaKsIJcBqUcY.jpg",
      "year": "2024",
      "rating": 9.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Фантастика",
        "Боевик",
        "Драма"
      ],
      "source": "redheadsound",
      "description": "Кульминация противостояния городов-близнецов Пилтовера и Зауна и сестер Вай и Джинкс."
    },
    {
      "id": "anilibria_solo_leveling2",
      "title": "Поднятие уровня в одиночку",
      "original_title": "Solo Leveling",
      "poster": "https://image.tmdb.org/t/p/w500/8u56LKz0An8xa9YaFtkxsDKc5N5.jpg",
      "year": "2025",
      "rating": 8.6,
      "quality": "1080p FHD",
      "is4K": false,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Боевик",
        "Фэнтези"
      ],
      "source": "anilibria",
      "description": "Путь слабейшего охотника человечества к вершине могущества."
    },
    {
      "id": "tmdb_deadpool_wolverine",
      "title": "Дэдпул и Росомаха",
      "original_title": "Deadpool & Wolverine",
      "poster": "https://image.tmdb.org/t/p/w500/4Li3gy8Ga6q0bAz2odg7ZFoRqLy.jpg",
      "year": "2024",
      "rating": 8.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Комедия",
        "Фантастика"
      ],
      "source": "tmdb",
      "description": "Уэйд Уилсон объединяется с угрюмым Росомахой из альтернативной вселенной для спасения мультивселенной."
    },
    {
      "id": "lostfilm_fallout",
      "title": "Фоллаут",
      "original_title": "Fallout",
      "poster": "https://image.tmdb.org/t/p/w500/7o3XRf31lEtAaRNtgupOGTDD3sP.jpg",
      "year": "2024",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Фантастика",
        "Приключения",
        "Боевик"
      ],
      "source": "lostfilm",
      "description": "Выходцы из безопасных подземных Убежищ сталкиваются с жестоким и причудливым миром постапокалиптической Пустоши."
    },
    {
      "id": "tmdb_wild_robot",
      "title": "Дикий робот",
      "original_title": "The Wild Robot",
      "poster": "https://image.tmdb.org/t/p/w500/sDTumQBxhIyYbZ9acsTtoLfb5ZG.jpg",
      "year": "2024",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Фантастика",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "Робот ROZZUM 7134 терпит крушение на необитаемом острове и учится дружить с дикими животными."
    },
    {
      "id": "lostfilm_silo2",
      "title": "Укрытие",
      "original_title": "Silo",
      "poster": "https://image.tmdb.org/t/p/w500/1y0y7p1tT1q6JzLz6T9wZ9vQyY.jpg",
      "year": "2024",
      "rating": 8.3,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Фантастика",
        "Драма",
        "Триллер"
      ],
      "source": "lostfilm",
      "description": "Тысячи людей живут в 144-этажном подземном бункере, где никто не помнит, почему внешний мир смертельно опасен."
    },
    {
      "id": "tmdb_substance",
      "title": "Субстанция",
      "original_title": "The Substance",
      "poster": "https://image.tmdb.org/t/p/w500/lqoMzCcZYEFK729Fc6r0pfz0Fio.jpg",
      "year": "2024",
      "rating": 8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Ужасы",
        "Драма",
        "Фантастика"
      ],
      "source": "tmdb",
      "description": "Угасающая голливудская звезда принимает экспериментальный препарат, порождающий ее молодую и совершенную версию."
    },
    {
      "id": "tmdb_alien_romulus",
      "title": "Чужой: Ромул",
      "original_title": "Alien: Romulus",
      "poster": "https://image.tmdb.org/t/p/w500/b33nnKl1v2446XZTQ3yaUR0umg5.jpg",
      "year": "2024",
      "rating": 7.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Ужасы",
        "Фантастика",
        "Боевик"
      ],
      "source": "tmdb",
      "description": "Группа молодых колонистов исследует заброшенную космическую станцию и сталкивается с самой смертоносной формой жизни."
    },
    {
      "id": "lostfilm_the_boys",
      "title": "Пацаны",
      "original_title": "The Boys",
      "poster": "https://image.tmdb.org/t/p/w500/3NqlBDpWI83TgQ9nmeFwTVxEmtZ.jpg",
      "year": "2024",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Боевик",
        "Фантастика",
        "Комедия"
      ],
      "source": "lostfilm",
      "description": "Отряд мстителей противостоит зарвавшимся корпоративным супергероям с сомнительной моралью."
    },
    {
      "id": "tmdb_inside_out_2",
      "title": "Головоломка 2",
      "original_title": "Inside Out 2",
      "poster": "https://image.tmdb.org/t/p/w500/5fXrqBIvatwSuph7nTuSETBQYxm.jpg",
      "year": "2024",
      "rating": 8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Комедия",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "В голове взрослеющей Райли появляются новые эмоции — Тревожность, Зависть, Стыд и Хандра."
    },
    {
      "id": "lostfilm_house_dragon",
      "title": "Дом Дракона",
      "original_title": "House of the Dragon",
      "poster": "https://image.tmdb.org/t/p/w500/7QMsOTMUswlwxJP0rTTZfmz2tX2.jpg",
      "year": "2024",
      "rating": 8.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Фэнтези",
        "Драма",
        "Боевик"
      ],
      "source": "lostfilm",
      "description": "Кровопролитная гражданская война «Танец драконов» за Железный трон между ветвями дома Таргариенов."
    },
    {
      "id": "tmdb_furiosa",
      "title": "Фуриоса: Хроники Безумного Макса",
      "original_title": "Furiosa: A Mad Max Saga",
      "poster": "https://image.tmdb.org/t/p/w500/iADOJ8Zymht2JPMoy3R7xUMZqaC.jpg",
      "year": "2024",
      "rating": 7.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Приключения",
        "Фантастика"
      ],
      "source": "tmdb",
      "description": "История юной воительницы Фуриосы, похищенной ордой байкеров Дементуса в постапокалиптической Пустоши."
    },
    {
      "id": "anilibria_frieren",
      "title": "Провожающая в последний путь Фрирен",
      "original_title": "Sousou no Frieren",
      "poster": "https://image.tmdb.org/t/p/w500/bxWVzZ6oq5SdUBOcG74IavUlHGd.jpg",
      "year": "2024",
      "rating": 9.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фэнтези",
        "Приключения"
      ],
      "source": "anilibria",
      "description": "Философское странствие эльфийки Фрирен после победы над Королём демонов."
    },
    {
      "id": "tmdb_invincible",
      "title": "Неуязвимый",
      "original_title": "Invincible",
      "poster": "https://image.tmdb.org/t/p/w500/dMO0CA4v7E18X06V8G2tC2h7c9.jpg",
      "year": "2024",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Боевик",
        "Фантастика",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Марк Грейсон открывает свои суперспособности и узнает мрачную тайну своего отца Омни-мэна."
    },
    {
      "id": "lostfilm_slow_horses",
      "title": "Медленные лошади",
      "original_title": "Slow Horses",
      "poster": "https://image.tmdb.org/t/p/w500/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg",
      "year": "2024",
      "rating": 8.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Триллер",
        "Драма",
        "Комедия"
      ],
      "source": "lostfilm",
      "description": "Опальные агенты британской разведки MI5 под руководством невыносимого Джексона Лэма расследуют заговоры."
    },
    {
      "id": "tmdb_civil_war",
      "title": "Падение империи",
      "original_title": "Civil War",
      "poster": "https://image.tmdb.org/t/p/w500/sh7Rg8Er3tFcN9BpKIPOMvALgZd.jpg",
      "year": "2024",
      "rating": 7.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Драма",
        "Триллер"
      ],
      "source": "tmdb",
      "description": "Группа военных журналистов пробирается через охваченные гражданской войной США к Вашингтону."
    },
    {
      "id": "tmdb_despicable_me_4",
      "title": "Гадкий я 4",
      "original_title": "Despicable Me 4",
      "poster": "https://image.tmdb.org/t/p/w500/wWba3TaojhK7NjnTC0vFE52vB9Z.jpg",
      "year": "2024",
      "rating": 7.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Комедия",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "Грю и его семья сталкиваются с новым мстительным врагом Максимом Ле Малем и супер-минонами."
    },
    {
      "id": "shiki_look_back",
      "title": "Оглянись",
      "original_title": "Look Back",
      "poster": "https://image.tmdb.org/t/p/w500/6YkQu9TRAsZhGGh0t7U7DP1BuhQ.jpg",
      "year": "2024",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Драма"
      ],
      "source": "shikimori",
      "description": "История дружбы двух школьниц-мангак и их общего творческого пути от автора «Человека-бензопилы»."
    }
  ],
  "movies": [
    {
      "id": "82529",
      "title": "Человек-паук: Новый день",
      "original_title": "Spider-Man: Brand New Day",
      "poster": "https://image.tmdb.org/t/p/w500/pK8CH9JxrgX2ZIq3WclTwnX0cCL.jpg",
      "year": "2026",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Фантастика",
        "Боевик",
        "Приключения"
      ],
      "source": "fanfilm4k",
      "url": "https://v17.fanfilm4k.media/82529-chelovek-pauk-novyj-den-film.html",
      "description": "Питер Паркер сталкивается с последствиями стертой памяти мира и новыми угрозами Нью-Йорка в новой эре."
    },
    {
      "id": "tmdb_dune2",
      "title": "Дюна: Часть вторая",
      "original_title": "Dune: Part Two",
      "poster": "https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg",
      "year": "2024",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Фантастика",
        "Приключения",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Пол Атрейдес объединяется с Чани и фременами, чтобы отомстить заговорщикам, уничтожившим его семью."
    },
    {
      "id": "tmdb_oppenheimer",
      "title": "Оппенгеймер",
      "original_title": "Oppenheimer",
      "poster": "https://image.tmdb.org/t/p/w500/8OQzw8keE6sDNH25sOqPRTxhFTO.jpg",
      "year": "2023",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Драма",
        "История",
        "Биография"
      ],
      "source": "tmdb",
      "description": "История жизни американского физика Роберта Оппенгеймера и создания первой атомной бомбы."
    },
    {
      "id": "tmdb_deadpool_wolverine",
      "title": "Дэдпул и Росомаха",
      "original_title": "Deadpool & Wolverine",
      "poster": "https://image.tmdb.org/t/p/w500/4Li3gy8Ga6q0bAz2odg7ZFoRqLy.jpg",
      "year": "2024",
      "rating": 8.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Комедия",
        "Фантастика"
      ],
      "source": "tmdb",
      "description": "Уэйд Уилсон объединяется с угрюмым Росомахой из альтернативной вселенной для спасения мультивселенной."
    },
    {
      "id": "tmdb_gladiator2",
      "title": "Гладиатор 2",
      "original_title": "Gladiator II",
      "poster": "https://image.tmdb.org/t/p/w500/6N7F1Ga9m0CTHziA2Fs7BQczaKZ.jpg",
      "year": "2024",
      "rating": 7.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Приключения",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Спустя годы после гибели Максимуса повзрослевший Луций вынужден выйти на арену Колизея во имя свободы Рима."
    },
    {
      "id": "tmdb_interstellar",
      "title": "Интерстеллар",
      "original_title": "Interstellar",
      "poster": "https://image.tmdb.org/t/p/w500/vReLRjDV9XPhiOSEW7QWow4DXwf.jpg",
      "year": "2014",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Фантастика",
        "Драма",
        "Приключения"
      ],
      "source": "tmdb",
      "description": "Команда исследователей отправляется сквозь червоточину в поисках нового дома для человечества."
    },
    {
      "id": "tmdb_substance",
      "title": "Субстанция",
      "original_title": "The Substance",
      "poster": "https://image.tmdb.org/t/p/w500/lqoMzCcZYEFK729Fc6r0pfz0Fio.jpg",
      "year": "2024",
      "rating": 8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Ужасы",
        "Драма",
        "Фантастика"
      ],
      "source": "tmdb",
      "description": "Угасающая голливудская звезда принимает экспериментальный препарат, порождающий ее молодую и совершенную версию."
    },
    {
      "id": "tmdb_alien_romulus",
      "title": "Чужой: Ромул",
      "original_title": "Alien: Romulus",
      "poster": "https://image.tmdb.org/t/p/w500/b33nnKl1v2446XZTQ3yaUR0umg5.jpg",
      "year": "2024",
      "rating": 7.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Ужасы",
        "Фантастика",
        "Боевик"
      ],
      "source": "tmdb",
      "description": "Группа молодых колонистов исследует заброшенную космическую станцию и сталкивается с самой смертоносной формой жизни."
    },
    {
      "id": "tmdb_furiosa",
      "title": "Фуриоса: Хроники Безумного Макса",
      "original_title": "Furiosa: A Mad Max Saga",
      "poster": "https://image.tmdb.org/t/p/w500/iADOJ8Zymht2JPMoy3R7xUMZqaC.jpg",
      "year": "2024",
      "rating": 7.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Приключения",
        "Фантастика"
      ],
      "source": "tmdb",
      "description": "История юной воительницы Фуриосы, похищенной ордой байкеров Дементуса в постапокалиптической Пустоши."
    },
    {
      "id": "tmdb_civil_war",
      "title": "Падение империи",
      "original_title": "Civil War",
      "poster": "https://image.tmdb.org/t/p/w500/sh7Rg8Er3tFcN9BpKIPOMvALgZd.jpg",
      "year": "2024",
      "rating": 7.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Драма",
        "Триллер"
      ],
      "source": "tmdb",
      "description": "Группа военных журналистов пробирается через охваченные гражданской войной США к Вашингтону."
    },
    {
      "id": "tmdb_dark_knight",
      "title": "Тёмный рыцарь",
      "original_title": "The Dark Knight",
      "poster": "https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
      "year": "2008",
      "rating": 9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Криминал",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Бэтмен поднимает ставки в войне с криминалом Готэма, когда на арену выходит гений хаоса — Джокер."
    },
    {
      "id": "tmdb_inception",
      "title": "Начало",
      "original_title": "Inception",
      "poster": "https://image.tmdb.org/t/p/w500/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg",
      "year": "2010",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Фантастика",
        "Приключения"
      ],
      "source": "tmdb",
      "description": "Мастер проникновения в сны получает сложнейшее задание: не украсть мысль, а внедрить новую."
    },
    {
      "id": "tmdb_matrix",
      "title": "Матрица",
      "original_title": "The Matrix",
      "poster": "https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg",
      "year": "1999",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Фантастика"
      ],
      "source": "tmdb",
      "description": "Хакер Нео узнает, что весь окружающий его мир — иллюзия, созданная разумными машинами."
    },
    {
      "id": "tmdb_fight_club",
      "title": "Бойцовский клуб",
      "original_title": "Fight Club",
      "poster": "https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
      "year": "1999",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Драма",
        "Триллер"
      ],
      "source": "tmdb",
      "description": "Страдающий бессонницей клерк и харизматичный торговец мылом создают подпольный бойцовский клуб."
    },
    {
      "id": "tmdb_pulp_fiction",
      "title": "Криминальное чтиво",
      "original_title": "Pulp Fiction",
      "poster": "https://image.tmdb.org/t/p/w500/d5iIlFnGhFvl0206o9byYq8Cq6M.jpg",
      "year": "1994",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Криминал",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Культовые философские диалоги и переплетенные криминальные истории Лос-Анджелеса от Квентина Тарантино."
    },
    {
      "id": "tmdb_blade_runner_2049",
      "title": "Бегущий по лезвию 2049",
      "original_title": "Blade Runner 2049",
      "poster": "https://image.tmdb.org/t/p/w500/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg",
      "year": "2017",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Фантастика",
        "Драма",
        "Детектив"
      ],
      "source": "tmdb",
      "description": "Офицер полиции К раскапывает давно погребенную тайну, способную повергнуть остатки общества в хаос."
    },
    {
      "id": "tmdb_avatar_way_water",
      "title": "Аватар: Путь воды",
      "original_title": "Avatar: The Way of Water",
      "poster": "https://image.tmdb.org/t/p/w500/t6HIqrRAclMCA60NsSmeqe9RmNV.jpg",
      "year": "2022",
      "rating": 8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Фантастика",
        "Боевик",
        "Приключения"
      ],
      "source": "tmdb",
      "description": "Джейк Салли и Нейтири защищают свою семью и океанские рифы Пандоры от вернувшихся людей."
    },
    {
      "id": "tmdb_poor_things",
      "title": "Бедные-несчастные",
      "original_title": "Poor Things",
      "poster": "https://image.tmdb.org/t/p/w500/kCGlIMHnOm8JPXq3rXM6c5wMxcT.jpg",
      "year": "2023",
      "rating": 8.2,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Комедия",
        "Фэнтези",
        "Романтика"
      ],
      "source": "tmdb",
      "description": "Невероятная эволюция Беллы Бакстер, молодой женщины, возвращенной к жизни гениальным ученым."
    },
    {
      "id": "tmdb_monkey_man",
      "title": "Манкимэн",
      "original_title": "Monkey Man",
      "poster": "https://image.tmdb.org/t/p/w500/4lhR49nmv5ZWn9tGkYvN10yN9Yh.jpg",
      "year": "2024",
      "rating": 7.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Триллер"
      ],
      "source": "tmdb",
      "description": "Парень в маске обезьяны выходит на тропу беспощадной мести продажным лидерам индийского мегаполиса."
    },
    {
      "id": "tmdb_batman_2022",
      "title": "Бэтмен",
      "original_title": "The Batman",
      "poster": "https://image.tmdb.org/t/p/w500/74xTEgt7R36Fpooo50r9T25onhq.jpg",
      "year": "2022",
      "rating": 8.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Криминал",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Брюс Уэйн во второй год своей борьбы с преступностью расследует серию убийств чиновников Готэма Загадочником."
    },
    {
      "id": "tmdb_top_gun_maverick",
      "title": "Топ Ган: Мэверик",
      "original_title": "Top Gun: Maverick",
      "poster": "https://image.tmdb.org/t/p/w500/62HCnUTziyWcpDaBO2i1DX17ljH.jpg",
      "year": "2022",
      "rating": 8.3,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Пит Митчелл обучает выпускников элитной летной школы для выполнения смертельно опасной секретной миссии."
    },
    {
      "id": "tmdb_spider_no_way_home",
      "title": "Человек-паук: Нет пути домой",
      "original_title": "Spider-Man: No Way Home",
      "poster": "https://image.tmdb.org/t/p/w500/uJYYizSuA9Y3DCs0qS4qWvHfZg4.jpg",
      "year": "2021",
      "rating": 8.2,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Приключения",
        "Фантастика"
      ],
      "source": "tmdb",
      "description": "Личность Человека-паука раскрыта, и заклинание Доктора Стрэнджа открывает проход злодеям из других вселенных."
    },
    {
      "id": "tmdb_godzilla_minus_one",
      "title": "Годзилла: Минус один",
      "original_title": "Gojira -1.0",
      "poster": "https://image.tmdb.org/t/p/w500/hkxxMIGaiCTmrEArK7J56JTKUlB.jpg",
      "year": "2023",
      "rating": 8.3,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Боевик",
        "Фантастика",
        "Драма"
      ],
      "source": "tmdb",
      "description": "В послевоенной разрушенной Японии внезапно появляется гигантский монстр Годзилла, повергая страну в минус."
    },
    {
      "id": "tmdb_challengers",
      "title": "Претенденты",
      "original_title": "Challengers",
      "poster": "https://image.tmdb.org/t/p/w500/H6vke73qEpL2zYvZyYqD9wa5Yv.jpg",
      "year": "2024",
      "rating": 7.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "movie",
      "category": "Фильм",
      "genres": [
        "Драма",
        "Мелодрама",
        "Спорт"
      ],
      "source": "tmdb",
      "description": "Напряженный любовный треугольник и ожесточенное соперничество трех теннисистов на корте и в жизни."
    }
  ],
  "series": [
    {
      "id": "rutube_landyshi",
      "title": "Ландыши",
      "original_title": "Ландыши. Такая нежная любовь",
      "poster": "https://pic.rtbcdn.ru/video/2025-01-13/bc/9f/bc9fda6d31c72a8002c8999542e877ab.jpg",
      "year": "2025–2026",
      "rating": 8.5,
      "quality": "1080p FHD",
      "is4K": false,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Мелодрама",
        "Драма",
        "Музыка"
      ],
      "source": "rutube",
      "rutube_id": "564f31c881b83373bfe0cb26979d44cf",
      "embed_url": "https://rutube.ru/play/embed/564f31c881b83373bfe0cb26979d44cf",
      "video_url": "https://rutube.ru/video/564f31c881b83373bfe0cb26979d44cf/",
      "total_episodes": 16,
      "seasons": 2,
      "description": "Популярная музыкальная мелодрама Wink о Кате Орловой и Лехе Данилине: любовь, распад группы, интриги и борьба за наследство."
    },
    {
      "id": "lostfilm_gentlemen",
      "title": "Джентльмены",
      "original_title": "The Gentlemen",
      "poster": "https://image.tmdb.org/t/p/w500/bpy9uaV0oOlKnEoPzodwrSSUFXg.jpg",
      "year": "2024",
      "rating": 8.2,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Криминал",
        "Комедия",
        "Боевик"
      ],
      "source": "lostfilm",
      "description": "Эдди Холстед наследует крупное поместье отца и неожиданно узнает, что оно является частью масштабной каннабис-империи."
    },
    {
      "id": "lostfilm_penguin",
      "title": "Пингвин",
      "original_title": "The Penguin",
      "poster": "https://image.tmdb.org/t/p/w500/25dj85s5VtirRWF6rmO8TpZXHJV.jpg",
      "year": "2024",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Криминал",
        "Драма"
      ],
      "source": "lostfilm",
      "description": "Освальд Кобблпот стремится захватить власть в криминальном мире Готэма после событий фильма «Бэтмен»."
    },
    {
      "id": "lostfilm_shogun",
      "title": "Сёгун",
      "original_title": "Shōgun",
      "poster": "https://image.tmdb.org/t/p/w500/cOKLRblbdBtcuf4TkAzsyJpZr23.jpg",
      "year": "2024",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Драма",
        "История",
        "Военный"
      ],
      "source": "lostfilm",
      "description": "В Японии начала XVII века английский штурман Джон Блэкторн оказывается втянут в смертельную борьбу феодальных кланов."
    },
    {
      "id": "lostfilm_fallout",
      "title": "Фоллаут",
      "original_title": "Fallout",
      "poster": "https://image.tmdb.org/t/p/w500/7o3XRf31lEtAaRNtgupOGTDD3sP.jpg",
      "year": "2024",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Фантастика",
        "Приключения",
        "Боевик"
      ],
      "source": "lostfilm",
      "description": "Выходцы из безопасных подземных Убежищ сталкиваются с жестоким и причудливым миром постапокалиптической Пустоши."
    },
    {
      "id": "lostfilm_the_boys",
      "title": "Пацаны",
      "original_title": "The Boys",
      "poster": "https://image.tmdb.org/t/p/w500/3NqlBDpWI83TgQ9nmeFwTVxEmtZ.jpg",
      "year": "2024",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Боевик",
        "Фантастика",
        "Комедия"
      ],
      "source": "lostfilm",
      "description": "Отряд мстителей противостоит зарвавшимся корпоративным супергероям с сомнительной моралью."
    },
    {
      "id": "lostfilm_house_dragon",
      "title": "Дом Дракона",
      "original_title": "House of the Dragon",
      "poster": "https://image.tmdb.org/t/p/w500/7QMsOTMUswlwxJP0rTTZfmz2tX2.jpg",
      "year": "2024",
      "rating": 8.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Фэнтези",
        "Драма",
        "Боевик"
      ],
      "source": "lostfilm",
      "description": "Кровопролитная гражданская война «Танец драконов» за Железный трон между ветвями дома Таргариенов."
    },
    {
      "id": "lostfilm_last_of_us",
      "title": "Одни из нас",
      "original_title": "The Last of Us",
      "poster": "https://image.tmdb.org/t/p/w500/uKvVjHNqB5VmOrdxqAt2V7JMrne.jpg",
      "year": "2023",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Драма",
        "Ужасы",
        "Фантастика"
      ],
      "source": "lostfilm",
      "description": "Закаленный контрабандист Джоэл сопровождает 14-летнюю Элли через разрушенные США с надеждой спасти мир."
    },
    {
      "id": "lostfilm_breaking_bad",
      "title": "Во все тяжкие",
      "original_title": "Breaking Bad",
      "poster": "https://image.tmdb.org/t/p/w500/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg",
      "year": "2008",
      "rating": 9.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Драма",
        "Криминал",
        "Триллер"
      ],
      "source": "lostfilm",
      "description": "Смертельно больной школьный учитель химии Уолтер Уайт начинает варить кристаллический метамфетамин."
    },
    {
      "id": "lostfilm_game_thrones",
      "title": "Игра престолов",
      "original_title": "Game of Thrones",
      "poster": "https://image.tmdb.org/t/p/w500/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg",
      "year": "2011",
      "rating": 9.2,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Фэнтези",
        "Драма",
        "Приключения"
      ],
      "source": "lostfilm",
      "description": "Благородные семьи Вестероса ведут смертельную борьбу за контроль над Семью Королевствами."
    },
    {
      "id": "lostfilm_stranger_things",
      "title": "Очень странные дела",
      "original_title": "Stranger Things",
      "poster": "https://image.tmdb.org/t/p/w500/49WJfeN0moxb9IPfGn8AIqMGskD.jpg",
      "year": "2022",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Фантастика",
        "Ужасы",
        "Драма"
      ],
      "source": "lostfilm",
      "description": "В тихом городке Хоукинс исчезает мальчик, а его друзья встречают девочку с невероятными способностями."
    },
    {
      "id": "lostfilm_dark",
      "title": "Тьма",
      "original_title": "Dark",
      "poster": "https://image.tmdb.org/t/p/w500/apbrbWs8M9lyOpJYU5WXrpFbk1Z.jpg",
      "year": "2017",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Фантастика",
        "Драма",
        "Детектив"
      ],
      "source": "lostfilm",
      "description": "Исчезновение двух детей в немецком городке Винден обнажает запутанные связи и тайну путешествий во времени."
    },
    {
      "id": "lostfilm_true_detective",
      "title": "Настоящий детектив",
      "original_title": "True Detective",
      "poster": "https://image.tmdb.org/t/p/w500/cuV2O53rBPVGg9YPsG280Q9Q0qw.jpg",
      "year": "2024",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Драма",
        "Детектив",
        "Криминал"
      ],
      "source": "lostfilm",
      "description": "Антология глубоких психологических и философских расследований запутанных ритуальных преступлений."
    },
    {
      "id": "lostfilm_severance",
      "title": "Разделение",
      "original_title": "Severance",
      "poster": "https://image.tmdb.org/t/p/w500/pPHpeIql5T9HR8Fw75K4ZfauG37.jpg",
      "year": "2022",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Фантастика",
        "Триллер",
        "Детектив"
      ],
      "source": "lostfilm",
      "description": "Сотрудники корпорации соглашаются на операцию, разделяющую рабочие воспоминания и личную жизнь."
    },
    {
      "id": "lostfilm_silo2",
      "title": "Укрытие",
      "original_title": "Silo",
      "poster": "https://image.tmdb.org/t/p/w500/1y0y7p1tT1q6JzLz6T9wZ9vQyY.jpg",
      "year": "2024",
      "rating": 8.3,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Фантастика",
        "Драма",
        "Триллер"
      ],
      "source": "lostfilm",
      "description": "Тысячи людей живут в 144-этажном подземном бункере, где никто не помнит, почему внешний мир смертельно опасен."
    },
    {
      "id": "lostfilm_slow_horses",
      "title": "Медленные лошади",
      "original_title": "Slow Horses",
      "poster": "https://image.tmdb.org/t/p/w500/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg",
      "year": "2024",
      "rating": 8.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Триллер",
        "Драма",
        "Комедия"
      ],
      "source": "lostfilm",
      "description": "Опальные агенты британской разведки MI5 под руководством невыносимого Джексона Лэма расследуют заговоры."
    },
    {
      "id": "lostfilm_fargo",
      "title": "Фарго",
      "original_title": "Fargo",
      "poster": "https://image.tmdb.org/t/p/w500/6NsI13d9sYxM3y3CjB5P1Wf29lS.jpg",
      "year": "2024",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Криминал",
        "Драма",
        "Комедия"
      ],
      "source": "lostfilm",
      "description": "Криминальная антология, полная черного юмора, эксцентричных персонажей и смертельных случайностей на Среднем Западе."
    },
    {
      "id": "lostfilm_chernobyl",
      "title": "Чернобыль",
      "original_title": "Chernobyl",
      "poster": "https://image.tmdb.org/t/p/w500/hlLXt2tOPT6RRnjiUmoxyG1LTFi.jpg",
      "year": "2019",
      "rating": 9.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Драма",
        "История"
      ],
      "source": "lostfilm",
      "description": "Хроника катастрофы на Чернобыльской АЭС в 1986 году и подвиг людей, боровшихся за предотвращение худшего."
    },
    {
      "id": "lostfilm_sherlock",
      "title": "Шерлок",
      "original_title": "Sherlock",
      "poster": "https://image.tmdb.org/t/p/w500/7WTsnDMmstAwh9cf9w11jqnu2dt.jpg",
      "year": "2010",
      "rating": 9.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Детектив",
        "Драма",
        "Криминал"
      ],
      "source": "lostfilm",
      "description": "Современная версия приключений легендарного сыщика Шерлока Холмса и доктора Джона Ватсона в Лондоне XXI века."
    },
    {
      "id": "lostfilm_peaky_blinders",
      "title": "Острые козырьки",
      "original_title": "Peaky Blinders",
      "poster": "https://image.tmdb.org/t/p/w500/vUUqzWa2LnHIVqkaKVlVGkVcZIW.jpg",
      "year": "2013",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Криминал",
        "Драма"
      ],
      "source": "lostfilm",
      "description": "Британская криминальная династия Шелби в Бирмингеме 1920-х годов стремится к вершинам власти."
    },
    {
      "id": "lostfilm_better_call_saul",
      "title": "Лучше звоните Солу",
      "original_title": "Better Call Saul",
      "poster": "https://image.tmdb.org/t/p/w500/fC2HDm5t0kHjUmYIMBYVzsudutO.jpg",
      "year": "2015",
      "rating": 9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Драма",
        "Криминал"
      ],
      "source": "lostfilm",
      "description": "Превращение мелкого адвоката Джимми Макгилла в беспринципного защитника криминального мира Сола Гудмана."
    },
    {
      "id": "lostfilm_succession",
      "title": "Наследники",
      "original_title": "Succession",
      "poster": "https://image.tmdb.org/t/p/w500/7HW473VZs9yp59gB89495Y51H6B.jpg",
      "year": "2023",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Драма"
      ],
      "source": "lostfilm",
      "description": "Безжалостная борьба за власть и контроль над глобальным медиаконгломератом внутри влиятельной семьи Рой."
    },
    {
      "id": "lostfilm_vikings",
      "title": "Викинги",
      "original_title": "Vikings",
      "poster": "https://image.tmdb.org/t/p/w500/bQLrHIRNEkE3PdIWQrZH9Q0vYv.jpg",
      "year": "2013",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Боевик",
        "Драма",
        "История"
      ],
      "source": "lostfilm",
      "description": "Восхождение легендарного вождя викингов Рагнара Лодброка от простого фермера до короля."
    },
    {
      "id": "lostfilm_bear",
      "title": "Медведь",
      "original_title": "The Bear",
      "poster": "https://image.tmdb.org/t/p/w500/535nE0I8lU6nKzN91vM9WnQ1Z4v.jpg",
      "year": "2024",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Драма",
        "Комедия"
      ],
      "source": "lostfilm",
      "description": "Талантливый шеф-повар возвращается в Чикаго, чтобы спасти семейную забегаловку после трагедии."
    },
    {
      "id": "lostfilm_from",
      "title": "Извне",
      "original_title": "From",
      "poster": "https://image.tmdb.org/t/p/w500/49z9w11vKz0p2sQ1Z4v0Q1Z4v0.jpg",
      "year": "2024",
      "rating": 8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "series",
      "category": "Сериал",
      "genres": [
        "Ужасы",
        "Фантастика",
        "Драма"
      ],
      "source": "lostfilm",
      "description": "Загадочный город-ловушка посреди леса, пленники которого каждую ночь спасаются от жутких ночных существ."
    }
  ],
  "cartoons": [
    {
      "id": "tmdb_wild_robot",
      "title": "Дикий робот",
      "original_title": "The Wild Robot",
      "poster": "https://image.tmdb.org/t/p/w500/sDTumQBxhIyYbZ9acsTtoLfb5ZG.jpg",
      "year": "2024",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Фантастика",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "Робот ROZZUM 7134 терпит крушение на необитаемом острове и учится дружить с дикими животными."
    },
    {
      "id": "tmdb_inside_out_2",
      "title": "Головоломка 2",
      "original_title": "Inside Out 2",
      "poster": "https://image.tmdb.org/t/p/w500/5fXrqBIvatwSuph7nTuSETBQYxm.jpg",
      "year": "2024",
      "rating": 8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Комедия",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "В голове взрослеющей Райли появляются новые эмоции — Тревожность, Зависть, Стыд и Хандра."
    },
    {
      "id": "tmdb_spider_verse",
      "title": "Человек-паук: Паутина вселенных",
      "original_title": "Spider-Man: Across the Spider-Verse",
      "poster": "https://image.tmdb.org/t/p/w500/wH0kbTvbrvtlCygso7Ye2ZfGfM1.jpg",
      "year": "2023",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Боевик",
        "Приключения"
      ],
      "source": "tmdb",
      "description": "Майлз Моралес отправляется в путешествие по мультивселенной, где сталкивается с Обществом пауков."
    },
    {
      "id": "tmdb_despicable_me_4",
      "title": "Гадкий я 4",
      "original_title": "Despicable Me 4",
      "poster": "https://image.tmdb.org/t/p/w500/wWba3TaojhK7NjnTC0vFE52vB9Z.jpg",
      "year": "2024",
      "rating": 7.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Комедия",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "Грю и его семья сталкиваются с новым мстительным врагом Максимом Ле Малем и супер-минонами."
    },
    {
      "id": "tmdb_kung_fu_panda_4",
      "title": "Кунг-фу Панда 4",
      "original_title": "Kung Fu Panda 4",
      "poster": "https://image.tmdb.org/t/p/w500/kDp1vUBnMpe8ak4rjgl3cLELqjU.jpg",
      "year": "2024",
      "rating": 7.3,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Боевик",
        "Комедия"
      ],
      "source": "tmdb",
      "description": "По готовится стать Духовным лидером Долины Мира и находит преемницу в лице хитрой лисицы Чжэнь."
    },
    {
      "id": "tmdb_puss_in_boots_2",
      "title": "Кот в сапогах: Последнее желание",
      "original_title": "Puss in Boots: The Last Wish",
      "poster": "https://image.tmdb.org/t/p/w500/kuf6dutpsT0vSVehic3EZIqkOBt.jpg",
      "year": "2022",
      "rating": 8.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Приключения",
        "Комедия"
      ],
      "source": "tmdb",
      "description": "Потратив восемь из девяти жизней, легендарный Кот в сапогах отправляется на поиски Звезды Желаний."
    },
    {
      "id": "tmdb_moana_2",
      "title": "Моана 2",
      "original_title": "Moana 2",
      "poster": "https://image.tmdb.org/t/p/w500/aLVkiINNOeg2MDXZSlpsBGoxQE7.jpg",
      "year": "2024",
      "rating": 7.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Приключения",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "Моана получает зов от предков и вместе с Мауи отправляется в опасные дальние воды Океании."
    },
    {
      "id": "tmdb_wall_e",
      "title": "ВАЛЛ-И",
      "original_title": "WALL-E",
      "poster": "https://image.tmdb.org/t/p/w500/hbhFnRzzg6ZDmm8YAmxBnQMiQRS.jpg",
      "year": "2008",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Фантастика",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "Трогательный робот-мусорщик ВАЛЛ-И отправляется в космос вслед за прекрасной Евой."
    },
    {
      "id": "tmdb_up",
      "title": "Вверх",
      "original_title": "Up",
      "poster": "https://image.tmdb.org/t/p/w500/vpbaStTMt8qqGBE25aqfl3KpVU9.jpg",
      "year": "2009",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Приключения",
        "Драма"
      ],
      "source": "tmdb",
      "description": "78-летний Карл Фредриксен привязывает тысячи воздушных шаров к дому и улетает в Южную Америку."
    },
    {
      "id": "tmdb_coco",
      "title": "Тайна Коко",
      "original_title": "Coco",
      "poster": "https://image.tmdb.org/t/p/w500/eKi8dIrr8voobbaGzDpe8w0PVbC.jpg",
      "year": "2017",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Семейный",
        "Фэнтези"
      ],
      "source": "tmdb",
      "description": "Юный музыкант Мигель случайно попадает в красочный Мир Мертвых, чтобы разгадать семейную тайну."
    },
    {
      "id": "tmdb_ratatouille",
      "title": "Рататуй",
      "original_title": "Ratatouille",
      "poster": "https://image.tmdb.org/t/p/w500/t3vaWRPSf6WjDSamIkK946nqYFa.jpg",
      "year": "2007",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Комедия",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "Крыс Реми с утонченным вкусом мечтает стать великим шеф-поваром лучшего ресторана Парижа."
    },
    {
      "id": "tmdb_lion_king",
      "title": "Король Лев",
      "original_title": "The Lion King",
      "poster": "https://image.tmdb.org/t/p/w500/bKPtXn9n4M4s8vtbtYYeRoKKnTt.jpg",
      "year": "1994",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Драма",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "Львенок Симба проходит тернистый путь изгнания и взросления, чтобы вернуть трон Земель Прайда."
    },
    {
      "id": "tmdb_how_to_train_dragon",
      "title": "Как приручить дракона",
      "original_title": "How to Train Your Dragon",
      "poster": "https://image.tmdb.org/t/p/w500/ygGmAO60t8GyqUo9xYeG9yFqT2e.jpg",
      "year": "2010",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Фэнтези",
        "Приключения"
      ],
      "source": "tmdb",
      "description": "Юный викинг Иккинг находит общий язык с самым грозным драконом — Ночной Фурией по имени Беззубик."
    },
    {
      "id": "tmdb_zootopia",
      "title": "Зверополис",
      "original_title": "Zootopia",
      "poster": "https://image.tmdb.org/t/p/w500/sM33SANp9z6rDpWStfaTIzqUs3V.jpg",
      "year": "2016",
      "rating": 8.3,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Комедия",
        "Детектив"
      ],
      "source": "tmdb",
      "description": "Крольчиха-полицейский Джуди Хоппс и хитрый лис Ник Уайлд расследуют заговор в мегаполисе животных."
    },
    {
      "id": "tmdb_shrek",
      "title": "Шрэк",
      "original_title": "Shrek",
      "poster": "https://image.tmdb.org/t/p/w500/iB64vpL3dIObOtMZgX3RqWIXGpE.jpg",
      "year": "2001",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Комедия",
        "Фэнтези"
      ],
      "source": "tmdb",
      "description": "Зеленый великан Шрэк и болтливый Осел отправляются спасать принцессу Фиону из башни дракона."
    },
    {
      "id": "tmdb_soul",
      "title": "Душа",
      "original_title": "Soul",
      "poster": "https://image.tmdb.org/t/p/w500/hm58Jw4Lw8OIY9PtavCwStAgqyQ.jpg",
      "year": "2020",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Комедия",
        "Фэнтези"
      ],
      "source": "tmdb",
      "description": "Школьный учитель музыки попадает в мир до-жизни и учит молодую душу Двадцать Два ценить земные радости."
    },
    {
      "id": "tmdb_monsters_inc",
      "title": "Корпорация монстров",
      "original_title": "Monsters, Inc.",
      "poster": "https://image.tmdb.org/t/p/w500/sgheTgdpsoDxwIjESVd1Oa3t73W.jpg",
      "year": "2001",
      "rating": 8.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Комедия",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "Монстры Салли и Майк Вазовски случайно впускают в свой город человеческую девочку Бу."
    },
    {
      "id": "tmdb_finding_nemo",
      "title": "В поисках Немо",
      "original_title": "Finding Nemo",
      "poster": "https://image.tmdb.org/t/p/w500/eHuGQ10ocZZGRdzznshOpGTr4DH.jpg",
      "year": "2003",
      "rating": 8.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Приключения",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "Рыбка-клоун Марлин вместе с забывчивой Дори преодолевает океан ради спасения своего сына Немо."
    },
    {
      "id": "tmdb_toy_story",
      "title": "История игрушек",
      "original_title": "Toy Story",
      "poster": "https://image.tmdb.org/t/p/w500/uXDfjJbdP4ijW5hWSBrPrlKpxab.jpg",
      "year": "1995",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Комедия",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "Игрушечный ковбой Вуди ревнует хозяина к новейшему астронавту Баззу Лайтеру."
    },
    {
      "id": "tmdb_incredibles",
      "title": "Суперсемейка",
      "original_title": "The Incredibles",
      "poster": "https://image.tmdb.org/t/p/w500/2LqaLgk4Z226KkgPJuiOQ58wvrm.jpg",
      "year": "2004",
      "rating": 8.3,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Боевик",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "Семья скрывающихся супергероев вынуждена вновь надеть костюмы для борьбы со зловещим Синдромом."
    },
    {
      "id": "tmdb_cars",
      "title": "Тачки",
      "original_title": "Cars",
      "poster": "https://image.tmdb.org/t/p/w500/jpfkzbIXgKZqCZAkEkBtTkn9rqL.jpg",
      "year": "2006",
      "rating": 8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Комедия",
        "Приключения"
      ],
      "source": "tmdb",
      "description": "Самовлюбленный гоночный болид Молния Маккуин застревает в забытом городке Радиатор-Спрингс."
    },
    {
      "id": "tmdb_aladdin",
      "title": "Аладдин",
      "original_title": "Aladdin",
      "poster": "https://image.tmdb.org/t/p/w500/fLhe41yPZ2l6bYpXbJ9W9c4tF8u.jpg",
      "year": "1992",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Семейный",
        "Фэнтези"
      ],
      "source": "tmdb",
      "description": "Бедный юноша Аладдин находит волшебную лампу с Джинном и борется за любовь принцессы Жасмин."
    },
    {
      "id": "tmdb_spirited_away_cart",
      "title": "Унесённые призраками",
      "original_title": "Sen to Chihiro no Kamikakushi",
      "poster": "https://image.tmdb.org/t/p/w500/txaVo4whnSduKuczZiJexhLDVQC.jpg",
      "year": "2001",
      "rating": 9.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Аниме",
        "Фэнтези"
      ],
      "source": "tmdb",
      "description": "Девочка Тихиро попадает в волшебный мир духов и колдуньи Юбабы, чтобы спасти своих родителей."
    },
    {
      "id": "tmdb_mulan",
      "title": "Мулан",
      "original_title": "Mulan",
      "poster": "https://image.tmdb.org/t/p/w500/5k7m4vFw6l5m5mZ0k8J8v4X5M6.jpg",
      "year": "1998",
      "rating": 8.2,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoons",
      "category": "Мультфильм",
      "genres": [
        "Мультфильм",
        "Приключения",
        "Семейный"
      ],
      "source": "tmdb",
      "description": "Храбрая китайская девушка маскируется под мужчину и отправляется на войну вместо пожилого отца."
    }
  ],
  "cartoon-series": [
    {
      "id": "rhs_arcane2",
      "title": "Аркейн (2 сезон)",
      "original_title": "Arcane Season 2",
      "poster": "https://image.tmdb.org/t/p/w500/kVioUjk1SXGWblJNaKsIJcBqUcY.jpg",
      "year": "2024",
      "rating": 9.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Фантастика",
        "Боевик",
        "Драма"
      ],
      "source": "redheadsound",
      "description": "Кульминация противостояния городов-близнецов Пилтовера и Зауна и сестер Вай и Джинкс."
    },
    {
      "id": "fanfilm_rick_morty",
      "title": "Рик и Морти",
      "original_title": "Rick and Morty",
      "poster": "https://image.tmdb.org/t/p/w500/6D1NA4IMUFI8lBNuCBUlp7eLYDP.jpg",
      "year": "2023",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Комедия",
        "Фантастика",
        "Приключения"
      ],
      "source": "fanfilm4k",
      "description": "Безумные межгалактические приключения дедушки-гения и его неуверенного внука."
    },
    {
      "id": "tmdb_gravity_falls",
      "title": "Гравити Фолз",
      "original_title": "Gravity Falls",
      "poster": "https://image.tmdb.org/t/p/w500/hBgP8gZcW2nQk9D404fXb1W8Xv8.jpg",
      "year": "2012",
      "rating": 9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Мультфильм",
        "Комедия",
        "Детектив"
      ],
      "source": "tmdb",
      "description": "Близнецы Диппер и Мэйбл проводят каникулы у дяди Стэна и исследуют аномалии городка Гравити Фолз."
    },
    {
      "id": "tmdb_invincible",
      "title": "Неуязвимый",
      "original_title": "Invincible",
      "poster": "https://image.tmdb.org/t/p/w500/dMO0CA4v7E18X06V8G2tC2h7c9.jpg",
      "year": "2024",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Боевик",
        "Фантастика",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Марк Грейсон открывает свои суперспособности и узнает мрачную тайну своего отца Омни-мэна."
    },
    {
      "id": "tmdb_avatar_airbender",
      "title": "Аватар: Легенда об Аанге",
      "original_title": "Avatar: The Last Airbender",
      "poster": "https://image.tmdb.org/t/p/w500/cHFZAxb9MBvOq79Gv9v9m3c5Q1b.jpg",
      "year": "2005",
      "rating": 9.3,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Фэнтези",
        "Приключения",
        "Боевик"
      ],
      "source": "tmdb",
      "description": "Аанг, последний маг воздуха, должен овладеть четырьмя стихиями и остановить войну Народа Огня."
    },
    {
      "id": "tmdb_xmen_97",
      "title": "Люди Икс '97",
      "original_title": "X-Men '97",
      "poster": "https://image.tmdb.org/t/p/w500/9y3LqM3uU3WpE6K8lFm8H1m0m2.jpg",
      "year": "2024",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Боевик",
        "Фантастика",
        "Приключения"
      ],
      "source": "tmdb",
      "description": "Команда мутантов профессора Ксавье продолжает защищать мир, который их боится и ненавидит."
    },
    {
      "id": "tmdb_love_death_robots",
      "title": "Любовь, смерть и роботы",
      "original_title": "Love, Death & Robots",
      "poster": "https://image.tmdb.org/t/p/w500/asDpmXB4cb3UQI4v2m9iG1f9K3L.jpg",
      "year": "2022",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Фантастика",
        "Боевик",
        "Ужасы"
      ],
      "source": "tmdb",
      "description": "Антология смелых и визуально потрясающих короткометражных анимационных историй."
    },
    {
      "id": "tmdb_cyberpunk_edgerunners",
      "title": "Киберпанк: Бегущие по краю",
      "original_title": "Cyberpunk: Edgerunners",
      "poster": "https://image.tmdb.org/t/p/w500/7Jz2w2K5Qk1m5g1w1w1w1w1w1w1.jpg",
      "year": "2022",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Боевик",
        "Фантастика",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Уличный парень Дэвид в футуристическом Найт-Сити решает стать наемником-эджраннером."
    },
    {
      "id": "tmdb_batman_tas",
      "title": "Бэтмен (1992)",
      "original_title": "Batman: The Animated Series",
      "poster": "https://image.tmdb.org/t/p/w500/5k7m4vFw6l5m5mZ0k8J8v4X5M6.jpg",
      "year": "1992",
      "rating": 9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Боевик",
        "Криминал",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Культовый нео-нуарный анимационный сериал о Тёмном рыцаре Готэма."
    },
    {
      "id": "tmdb_star_wars_clone_wars",
      "title": "Звёздные войны: Войны клонов",
      "original_title": "Star Wars: The Clone Wars",
      "poster": "https://image.tmdb.org/t/p/w500/e1nWf6bWz5e4w6e7e8e9e0e1e2e.jpg",
      "year": "2008",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Фантастика",
        "Боевик",
        "Приключения"
      ],
      "source": "tmdb",
      "description": "Грандиозная галактическая война рыцарей-джедаев и Великой армии Республики против сепаратистов."
    },
    {
      "id": "tmdb_blue_eye_samurai",
      "title": "Голубоглазый самурай",
      "original_title": "Blue Eye Samurai",
      "poster": "https://image.tmdb.org/t/p/w500/yCgR8k5v7m1n5g1w1w1w1w1w1w1.jpg",
      "year": "2023",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Боевик",
        "Драма",
        "История"
      ],
      "source": "tmdb",
      "description": "В Японии эпохи Эдо мастер меча смешанной крови Мизу встает на путь беспощадной мести."
    },
    {
      "id": "tmdb_spider_man_94",
      "title": "Человек-паук (1994)",
      "original_title": "Spider-Man",
      "poster": "https://image.tmdb.org/t/p/w500/pK8CH9JxrgX2ZIq3WclTwnX0cCL.jpg",
      "year": "1994",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Боевик",
        "Фантастика",
        "Приключения"
      ],
      "source": "tmdb",
      "description": "Легендарный мультсериал о Питере Паркере и его непримиримой борьбе со злодеями."
    },
    {
      "id": "tmdb_castlevania",
      "title": "Кастлвания",
      "original_title": "Castlevania",
      "poster": "https://image.tmdb.org/t/p/w500/7Jz2w2K5Qk1m5g1w1w1w1w1w1w1.jpg",
      "year": "2021",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Фэнтези",
        "Ужасы",
        "Боевик"
      ],
      "source": "tmdb",
      "description": "Охотник на чудовищ Тревор Бельмонт сражается за спасение Валахии от ярости Дракулы."
    },
    {
      "id": "tmdb_bojack_horseman",
      "title": "Конь БоДжек",
      "original_title": "BoJack Horseman",
      "poster": "https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg",
      "year": "2014",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Комедия",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Забытая звезда ситкома 90-х конь БоДжек пытается справиться с депрессией и кризисом среднего возраста."
    },
    {
      "id": "tmdb_samurai_jack",
      "title": "Самурай Джек",
      "original_title": "Samurai Jack",
      "poster": "https://image.tmdb.org/t/p/w500/vReLRjDV9XPhiOSEW7QWow4DXwf.jpg",
      "year": "2001",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Боевик",
        "Фантастика",
        "Приключения"
      ],
      "source": "tmdb",
      "description": "Самурай из феодальной Японии заброшен в далекое дистопическое будущее коварным демоном Аку."
    },
    {
      "id": "tmdb_futurama",
      "title": "Футурама",
      "original_title": "Futurama",
      "poster": "https://image.tmdb.org/t/p/w500/6D1NA4IMUFI8lBNuCBUlp7eLYDP.jpg",
      "year": "2023",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Комедия",
        "Фантастика"
      ],
      "source": "tmdb",
      "description": "Разносчик пиццы Фрай случайно замораживается на тысячу лет и просыпается в XXXI веке."
    },
    {
      "id": "tmdb_adventure_time",
      "title": "Время приключений",
      "original_title": "Adventure Time",
      "poster": "https://image.tmdb.org/t/p/w500/hBgP8gZcW2nQk9D404fXb1W8Xv8.jpg",
      "year": "2010",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Фэнтези",
        "Комедия",
        "Приключения"
      ],
      "source": "tmdb",
      "description": "Мальчик Финн и его волшебная собака Джейк исследуют постапокалиптические Земли Ууу."
    },
    {
      "id": "tmdb_over_the_garden_wall",
      "title": "По ту сторону изгороди",
      "original_title": "Over the Garden Wall",
      "poster": "https://image.tmdb.org/t/p/w500/yCgR8k5v7m1n5g1w1w1w1w1w1w1.jpg",
      "year": "2014",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Фэнтези",
        "Приключения",
        "Детектив"
      ],
      "source": "tmdb",
      "description": "Два брата Варт и Грегори блуждают по таинственному лесу Неизведанное в поисках дороги домой."
    },
    {
      "id": "tmdb_harley_quinn",
      "title": "Харли Квинн",
      "original_title": "Harley Quinn",
      "poster": "https://image.tmdb.org/t/p/w500/4Li3gy8Ga6q0bAz2odg7ZFoRqLy.jpg",
      "year": "2023",
      "rating": 8.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Боевик",
        "Комедия",
        "Криминал"
      ],
      "source": "tmdb",
      "description": "Харли Квинн расстается с Джокером и пытается стать королевой преступного мира Готэма."
    },
    {
      "id": "tmdb_scavengers_reign",
      "title": "Царство падальщиков",
      "original_title": "Scavengers Reign",
      "poster": "https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg",
      "year": "2023",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Фантастика",
        "Драма",
        "Приключения"
      ],
      "source": "tmdb",
      "description": "Экипаж поврежденного космического корабля борется за выживание на прекрасной, но смертоносной планете."
    },
    {
      "id": "tmdb_primal",
      "title": "Первобытный",
      "original_title": "Primal",
      "poster": "https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
      "year": "2022",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Боевик",
        "Приключения",
        "Драма"
      ],
      "source": "tmdb",
      "description": "Пещерный человек и тираннозавр объединяются ради выживания в жестоком доисторическом мире."
    },
    {
      "id": "tmdb_south_park",
      "title": "Южный Парк",
      "original_title": "South Park",
      "poster": "https://image.tmdb.org/t/p/w500/3NqlBDpWI83TgQ9nmeFwTVxEmtZ.jpg",
      "year": "2024",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Комедия"
      ],
      "source": "tmdb",
      "description": "Острая социальная сатира на события современности через призму жизни четырех четвероклассников."
    },
    {
      "id": "tmdb_simpsons",
      "title": "Симпсоны",
      "original_title": "The Simpsons",
      "poster": "https://image.tmdb.org/t/p/w500/7o3XRf31lEtAaRNtgupOGTDD3sP.jpg",
      "year": "2024",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Комедия"
      ],
      "source": "tmdb",
      "description": "Культовая американская семейка Симпсонов из Спрингфилда в водовороте бесконечных приключений."
    },
    {
      "id": "tmdb_family_guy",
      "title": "Гриффины",
      "original_title": "Family Guy",
      "poster": "https://image.tmdb.org/t/p/w500/bpy9uaV0oOlKnEoPzodwrSSUFXg.jpg",
      "year": "2024",
      "rating": 8.2,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "cartoon-series",
      "category": "Мультсериал",
      "genres": [
        "Комедия"
      ],
      "source": "tmdb",
      "description": "Безумная жизнь эксцентричной семьи Питера Гриффина в городе Куахог."
    }
  ],
  "anime-movies": [
    {
      "id": "shiki_boy_heron",
      "title": "Мальчик и птица",
      "original_title": "Kimitachi wa Dou Ikiru ka",
      "poster": "https://image.tmdb.org/t/p/w500/oTmSnrE9MuQMhZkosZRE5bYvstK.jpg",
      "year": "2023",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Приключения",
        "Фэнтези"
      ],
      "source": "shikimori",
      "description": "Оскароносная анимационная картина Хаяо Миядзаки о путешествии в волшебный мир."
    },
    {
      "id": "shiki_your_name",
      "title": "Твоё имя",
      "original_title": "Kimi no Na wa.",
      "poster": "https://image.tmdb.org/t/p/w500/iH2WDCYLIUjc7oPWRT7Kxgxza6k.jpg",
      "year": "2016",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Романтика",
        "Драма"
      ],
      "source": "shikimori",
      "description": "Шедевр Макото Синкая о связи двух душ сквозь время и пространство."
    },
    {
      "id": "shiki_spirited_away",
      "title": "Унесённые призраками",
      "original_title": "Sen to Chihiro no Kamikakushi",
      "poster": "https://image.tmdb.org/t/p/w500/txaVo4whnSduKuczZiJexhLDVQC.jpg",
      "year": "2001",
      "rating": 9.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фэнтези",
        "Приключения"
      ],
      "source": "shikimori",
      "description": "Легендарная сказка Хаяо Миядзаки о девочке Тихиро в таинственном царстве духов."
    },
    {
      "id": "shiki_howls_castle",
      "title": "Ходячий замок",
      "original_title": "Howl no Ugoku Shiro",
      "poster": "https://image.tmdb.org/t/p/w500/oQvAlVSjYsJZPg9raiQRYE0aVrv.jpg",
      "year": "2004",
      "rating": 9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фэнтези",
        "Мелодрама"
      ],
      "source": "shikimori",
      "description": "История любви заколдованной шляпницы Софи и могущественного волшебника Хаула."
    },
    {
      "id": "shiki_silent_voice",
      "title": "Форма голоса",
      "original_title": "Koe no Katachi",
      "poster": "https://image.tmdb.org/t/p/w500/c0Gv8xTSEmIcQPxbhINKvkbJO8s.jpg",
      "year": "2016",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Драма",
        "Повседневность"
      ],
      "source": "shikimori",
      "description": "Трогательная история искупления, дружбы и взаимопонимания без слов."
    },
    {
      "id": "shiki_suzume",
      "title": "Судзумэ, закрывающая двери",
      "original_title": "Suzume no Tojimari",
      "poster": "https://image.tmdb.org/t/p/w500/6YkQu9TRAsZhGGh0t7U7DP1BuhQ.jpg",
      "year": "2022",
      "rating": 8.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фэнтези",
        "Приключения"
      ],
      "source": "shikimori",
      "description": "Путешествие юной Судзумэ по всей Японии для закрытия таинственных врат бедствий."
    },
    {
      "id": "shiki_demon_slayer_train",
      "title": "Клинок, рассекающий демонов: Бесконечный поезд",
      "original_title": "Kimetsu no Yaiba: Mugen Ressha-hen",
      "poster": "https://image.tmdb.org/t/p/w500/sFXMvI0I5GEiXRCJDIuzBBXpkiZ.jpg",
      "year": "2020",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Боевик",
        "Сёнэн"
      ],
      "source": "anixart",
      "description": "Битва Пламенного столпа Кёдзюро Рэнгоку против высших демонов на борту ночного поезда."
    },
    {
      "id": "shiki_totoro",
      "title": "Мой сосед Тоторо",
      "original_title": "Tonari no Totoro",
      "poster": "https://image.tmdb.org/t/p/w500/hTiDmJh24P7sKVEmtTZQU46f1LB.jpg",
      "year": "1988",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фэнтези",
        "Семейный"
      ],
      "source": "shikimori",
      "description": "Знакомство сестёр Сацуки и Мэй с добрым лесным духом Тоторо."
    },
    {
      "id": "shiki_princess_mononoke",
      "title": "Принцесса Мононоке",
      "original_title": "Mononoke Hime",
      "poster": "https://image.tmdb.org/t/p/w500/txaVo4whnSduKuczZiJexhLDVQC.jpg",
      "year": "1997",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фэнтези",
        "Приключения"
      ],
      "source": "shikimori",
      "description": "Юный принц Аситака оказывается в центре войны между духами древнего леса и людьми."
    },
    {
      "id": "shiki_weathering",
      "title": "Дитя погоды",
      "original_title": "Tenki no Ko",
      "poster": "https://image.tmdb.org/t/p/w500/iH2WDCYLIUjc7oPWRT7Kxgxza6k.jpg",
      "year": "2019",
      "rating": 8.3,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Романтика",
        "Фэнтези"
      ],
      "source": "shikimori",
      "description": "Сбежавший в дождливый Токио юноша встречает девушку, способную разгонять тучи силой мысли."
    },
    {
      "id": "shiki_grave_fireflies",
      "title": "Могила светлячков",
      "original_title": "Hotaru no Haka",
      "poster": "https://image.tmdb.org/t/p/w500/c0Gv8xTSEmIcQPxbhINKvkbJO8s.jpg",
      "year": "1988",
      "rating": 9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Драма",
        "Военный"
      ],
      "source": "shikimori",
      "description": "Трагическая история брата и маленькой сестры в Японии конца Второй мировой войны."
    },
    {
      "id": "shiki_akira",
      "title": "Акира",
      "original_title": "Akira",
      "poster": "https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg",
      "year": "1988",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фантастика",
        "Боевик"
      ],
      "source": "shikimori",
      "description": "Культовый киберпанк-шедевр о байкере Тэцуо, обретающем разрушительные телекинетические силы."
    },
    {
      "id": "shiki_ghost_shell",
      "title": "Призрак в доспехах",
      "original_title": "Koukaku Kidoutai",
      "poster": "https://image.tmdb.org/t/p/w500/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg",
      "year": "1995",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фантастика",
        "Боевик"
      ],
      "source": "shikimori",
      "description": "Майор Мотоко Кусанаги охотится на таинственного хакера Кукловода в кибернетическом будущем."
    },
    {
      "id": "shiki_perfect_blue",
      "title": "Истинная грусть",
      "original_title": "Perfect Blue",
      "poster": "https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
      "year": "1997",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Триллер",
        "Детектив"
      ],
      "source": "shikimori",
      "description": "Психологический триллер Сатоси Кона о поп-идоле Миме, теряющей грань между реальностью и ролью."
    },
    {
      "id": "shiki_wind_rises",
      "title": "Ветер крепчает",
      "original_title": "Kaze Tachinu",
      "poster": "https://image.tmdb.org/t/p/w500/oTmSnrE9MuQMhZkosZRE5bYvstK.jpg",
      "year": "2013",
      "rating": 8.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Драма",
        "Биография"
      ],
      "source": "shikimori",
      "description": "История гениального авиаконструктора Дзиро Хорикоси и его мечты о прекрасных самолетах."
    },
    {
      "id": "shiki_nausicaa",
      "title": "Навсикая из Долины ветров",
      "original_title": "Kaze no Tani no Nausicaa",
      "poster": "https://image.tmdb.org/t/p/w500/txaVo4whnSduKuczZiJexhLDVQC.jpg",
      "year": "1984",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фэнтези",
        "Фантастика"
      ],
      "source": "shikimori",
      "description": "Принцесса Навсикая пытается примирить человечество и гигантских насекомых Ому в отравленном мире."
    },
    {
      "id": "shiki_i_want_eat_pancreas",
      "title": "Я хочу съесть твою поджелудочную",
      "original_title": "Kimi no Suizou wo Tabetai",
      "poster": "https://image.tmdb.org/t/p/w500/c0Gv8xTSEmIcQPxbhINKvkbJO8s.jpg",
      "year": "2018",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Драма",
        "Романтика"
      ],
      "source": "shikimori",
      "description": "Замкнутый старшеклассник узнает о смертельной болезни одноклассницы и проводит с ней ее последние дни."
    },
    {
      "id": "shiki_jujutsu_kaisen_0",
      "title": "Магическая битва 0",
      "original_title": "Jujutsu Kaisen 0",
      "poster": "https://image.tmdb.org/t/p/w500/gsBwgwaW1YWHrQYbVymarruw1yN.jpg",
      "year": "2021",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Боевик",
        "Фэнтези"
      ],
      "source": "shikimori",
      "description": "Юта Оккоцу учится контролировать проклятого духа подруги детства в Токийском магическом колледже."
    },
    {
      "id": "shiki_castle_sky",
      "title": "Небесный замок Лапута",
      "original_title": "Tenkuu no Shiro Laputa",
      "poster": "https://image.tmdb.org/t/p/w500/oQvAlVSjYsJZPg9raiQRYE0aVrv.jpg",
      "year": "1986",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Приключения",
        "Фэнтези"
      ],
      "source": "shikimori",
      "description": "Мальчик Падзу и девочка Сита с летающим камнем ищут легендарный парящий остров Лапуту."
    },
    {
      "id": "shiki_kikis_delivery",
      "title": "Ведьмина служба доставки",
      "original_title": "Majo no Takkyuubin",
      "poster": "https://image.tmdb.org/t/p/w500/hTiDmJh24P7sKVEmtTZQU46f1LB.jpg",
      "year": "1989",
      "rating": 8.5,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фэнтези",
        "Семейный"
      ],
      "source": "shikimori",
      "description": "13-летняя ведьмочка Кики переезжает в приморский город и открывает службу доставки на метле."
    },
    {
      "id": "shiki_look_back",
      "title": "Оглянись",
      "original_title": "Look Back",
      "poster": "https://image.tmdb.org/t/p/w500/6YkQu9TRAsZhGGh0t7U7DP1BuhQ.jpg",
      "year": "2024",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Драма"
      ],
      "source": "shikimori",
      "description": "История дружбы двух школьниц-мангак и их общего творческого пути от автора «Человека-бензопилы»."
    },
    {
      "id": "shiki_paprika",
      "title": "Паприка",
      "original_title": "Paprika",
      "poster": "https://image.tmdb.org/t/p/w500/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg",
      "year": "2006",
      "rating": 8.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фантастика",
        "Детектив"
      ],
      "source": "shikimori",
      "description": "Психотерапевт Ацуко Тиба проникает в сны пациентов в образе альтер-эго Паприки, пока прибор не похищают."
    },
    {
      "id": "shiki_redline",
      "title": "Редлайн",
      "original_title": "Redline",
      "poster": "https://image.tmdb.org/t/p/w500/4Li3gy8Ga6q0bAz2odg7ZFoRqLy.jpg",
      "year": "2009",
      "rating": 8.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Боевик",
        "Фантастика"
      ],
      "source": "shikimori",
      "description": "Безумная гонка на выживание во вселенной, нарисованная вручную более чем за семь лет работы."
    },
    {
      "id": "shiki_evangelion_3",
      "title": "Евангелион 3.0+1.0",
      "original_title": "Shin Evangelion Gekijouban: ||",
      "poster": "https://image.tmdb.org/t/p/w500/8u56LKz0An8xa9YaFtkxsDKc5N5.jpg",
      "year": "2021",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-movie",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фантастика",
        "Драма"
      ],
      "source": "shikimori",
      "description": "Финал грандиозного ребилда культовой эпопеи Хидэаки Анно о Синдзи Икари и Евангелионах."
    }
  ],
  "anime-series": [
    {
      "id": "anilibria_solo_leveling2",
      "title": "Поднятие уровня в одиночку",
      "original_title": "Solo Leveling",
      "poster": "https://image.tmdb.org/t/p/w500/8u56LKz0An8xa9YaFtkxsDKc5N5.jpg",
      "year": "2025",
      "rating": 8.6,
      "quality": "1080p FHD",
      "is4K": false,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Боевик",
        "Фэнтези"
      ],
      "source": "anilibria",
      "description": "Путь слабейшего охотника человечества к вершине могущества."
    },
    {
      "id": "anilibria_demon_slayer",
      "title": "Клинок, рассекающий демонов",
      "original_title": "Kimetsu no Yaiba",
      "poster": "https://image.tmdb.org/t/p/w500/zg3GrU3jAoTGxmlGGhkfNYMOHlb.jpg",
      "year": "2024",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Боевик",
        "Сёнэн"
      ],
      "source": "anilibria",
      "description": "Танджиро Камадо сражается с высшими демонами ради исцеления своей сестры."
    },
    {
      "id": "anilibria_jujutsu_kaisen",
      "title": "Магическая битва",
      "original_title": "Jujutsu Kaisen",
      "poster": "https://image.tmdb.org/t/p/w500/gsBwgwaW1YWHrQYbVymarruw1yN.jpg",
      "year": "2023",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Мистика",
        "Боевик"
      ],
      "source": "anilibria",
      "description": "Борьба магов Токийского колледжа против проклятий высшего ранга."
    },
    {
      "id": "anilibria_attack_on_titan",
      "title": "Атака титанов",
      "original_title": "Shingeki no Kyojin",
      "poster": "https://image.tmdb.org/t/p/w500/9whSxgqSW7dPIIMJyM4WG3BYVo7.jpg",
      "year": "2023",
      "rating": 9.2,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Драма",
        "Боевик"
      ],
      "source": "anixart",
      "description": "Эпическая борьба остатков человечества за свободу против гигантских титанов."
    },
    {
      "id": "anilibria_frieren",
      "title": "Провожающая в последний путь Фрирен",
      "original_title": "Sousou no Frieren",
      "poster": "https://image.tmdb.org/t/p/w500/bxWVzZ6oq5SdUBOcG74IavUlHGd.jpg",
      "year": "2024",
      "rating": 9.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фэнтези",
        "Приключения"
      ],
      "source": "anilibria",
      "description": "Философское странствие эльфийки Фрирен после победы над Королём демонов."
    },
    {
      "id": "anilibria_chainsaw_man",
      "title": "Человек-бензопила",
      "original_title": "Chainsaw Man",
      "poster": "https://image.tmdb.org/t/p/w500/92Ds0hOHObvZBekqneimrGpxyXh.jpg",
      "year": "2022",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Боевик",
        "Ужасы"
      ],
      "source": "anixart",
      "description": "Дэндзи заключает договор с демоном Почитой и вступает в ряды охотников общественной безопасности."
    },
    {
      "id": "anilibria_death_note",
      "title": "Тетрадь смерти",
      "original_title": "Death Note",
      "poster": "https://image.tmdb.org/t/p/w500/t6HIqrRAclMCA60NsSmeqe9RmNV.jpg",
      "year": "2006",
      "rating": 9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Детектив",
        "Триллер"
      ],
      "source": "anilibria",
      "description": "Противостояние школьника Лайта Ягами с тетрадью бога смерти и гениального детектива L."
    },
    {
      "id": "anilibria_one_piece",
      "title": "Ван-Пис",
      "original_title": "One Piece",
      "poster": "https://image.tmdb.org/t/p/w500/c0Gv8xTSEmIcQPxbhINKvkbJO8s.jpg",
      "year": "2024",
      "rating": 9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Приключения",
        "Боевик"
      ],
      "source": "anilibria",
      "description": "Манки Д. Луффи и пираты Соломенной Шляпы ищут легендарное сокровище Ван-Пис."
    },
    {
      "id": "anilibria_naruto_shippuden",
      "title": "Наруто: Ураганные хроники",
      "original_title": "Naruto: Shippuuden",
      "poster": "https://image.tmdb.org/t/p/w500/zg3GrU3jAoTGxmlGGhkfNYMOHlb.jpg",
      "year": "2007",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Боевик",
        "Сёнэн"
      ],
      "source": "anilibria",
      "description": "Повзрослевший Наруто Узумаки защищает Деревню Скрытого Листа от организации Акацуки."
    },
    {
      "id": "anilibria_bleach_tybw",
      "title": "Блич: Тысячелетняя кровавая война",
      "original_title": "Bleach: Sennen Kessen-hen",
      "poster": "https://image.tmdb.org/t/p/w500/8u56LKz0An8xa9YaFtkxsDKc5N5.jpg",
      "year": "2024",
      "rating": 9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Боевик",
        "Сверхъестественное"
      ],
      "source": "anilibria",
      "description": "Куросаки Ичиго и Общество Душ сталкиваются с армией квинси под предводительством Яхве."
    },
    {
      "id": "anilibria_fullmetal_alchemist",
      "title": "Стальной алхимик: Братство",
      "original_title": "Hagane no Renkinjutsushi: Fullmetal Alchemist",
      "poster": "https://image.tmdb.org/t/p/w500/9whSxgqSW7dPIIMJyM4WG3BYVo7.jpg",
      "year": "2009",
      "rating": 9.3,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фэнтези",
        "Приключения"
      ],
      "source": "anilibria",
      "description": "Братья Элрики ищут философский камень, чтобы вернуть утраченные тела после неудачной трансмутации."
    },
    {
      "id": "anilibria_hunter_hunter",
      "title": "Хантер х Хантер",
      "original_title": "Hunter x Hunter",
      "poster": "https://image.tmdb.org/t/p/w500/gsBwgwaW1YWHrQYbVymarruw1yN.jpg",
      "year": "2011",
      "rating": 9.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Приключения",
        "Боевик"
      ],
      "source": "anilibria",
      "description": "Гон Фрикс сдает смертельный экзамен на охотника, чтобы найти своего отца Джина."
    },
    {
      "id": "anilibria_vinland_saga",
      "title": "Сага о Винланде",
      "original_title": "Vinland Saga",
      "poster": "https://image.tmdb.org/t/p/w500/bQLrHIRNEkE3PdIWQrZH9Q0vYv.jpg",
      "year": "2023",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "История",
        "Боевик"
      ],
      "source": "anilibria",
      "description": "Торфинн жаждет отомстить убийце своего отца и проходит путь от воина до искателя мира."
    },
    {
      "id": "anilibria_oshi_no_ko",
      "title": "Звёздное дитя",
      "original_title": "Oshi no Ko",
      "poster": "https://image.tmdb.org/t/p/w500/bxWVzZ6oq5SdUBOcG74IavUlHGd.jpg",
      "year": "2024",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Драма",
        "Детектив"
      ],
      "source": "anilibria",
      "description": "Реинкарнированный сын популярного айдола расследует темные тайны японского шоу-бизнеса."
    },
    {
      "id": "anilibria_dandadan",
      "title": "Дандадан",
      "original_title": "Dandadan",
      "poster": "https://image.tmdb.org/t/p/w500/92Ds0hOHObvZBekqneimrGpxyXh.jpg",
      "year": "2024",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Комедия",
        "Боевик"
      ],
      "source": "anilibria",
      "description": "Школьники Момо и Окарун сталкиваются с пришельцами и призраками в безумном водовороте битв."
    },
    {
      "id": "anilibria_spy_family",
      "title": "Семья шпиона",
      "original_title": "SPY x FAMILY",
      "poster": "https://image.tmdb.org/t/p/w500/t6HIqrRAclMCA60NsSmeqe9RmNV.jpg",
      "year": "2023",
      "rating": 8.6,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Комедия",
        "Боевик"
      ],
      "source": "anilibria",
      "description": "Шпион, наемная убийца и девочка-телепат создают фиктивную семью ради секретной миссии."
    },
    {
      "id": "anilibria_steins_gate",
      "title": "Врата Штейна",
      "original_title": "Steins;Gate",
      "poster": "https://image.tmdb.org/t/p/w500/c0Gv8xTSEmIcQPxbhINKvkbJO8s.jpg",
      "year": "2011",
      "rating": 9.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фантастика",
        "Триллер"
      ],
      "source": "anilibria",
      "description": "Безумный ученый Окабэ Ринтаро изобретает способ отправлять текстовые сообщения в прошлое."
    },
    {
      "id": "anilibria_code_geass",
      "title": "Код Гиас: Восставший Лелуш",
      "original_title": "Code Geass: Hangyaku no Lelouch",
      "poster": "https://image.tmdb.org/t/p/w500/zg3GrU3jAoTGxmlGGhkfNYMOHlb.jpg",
      "year": "2006",
      "rating": 8.9,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фантастика",
        "Боевик"
      ],
      "source": "anilibria",
      "description": "Опальный принц Лелуш получает силу абсолютного подчинения и начинает восстание против Британской Империи."
    },
    {
      "id": "anilibria_mob_psycho",
      "title": "Моб Психо 100",
      "original_title": "Mob Psycho 100",
      "poster": "https://image.tmdb.org/t/p/w500/8u56LKz0An8xa9YaFtkxsDKc5N5.jpg",
      "year": "2022",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Комедия",
        "Боевик"
      ],
      "source": "anilibria",
      "description": "Восьмиклассник Сигэо обладает сильнейшими экстрасенсорными способностями, но мечтает о нормальной жизни."
    },
    {
      "id": "anilibria_evangelion_series",
      "title": "Евангелион",
      "original_title": "Shin Seiki Evangelion",
      "poster": "https://image.tmdb.org/t/p/w500/9whSxgqSW7dPIIMJyM4WG3BYVo7.jpg",
      "year": "1995",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фантастика",
        "Психология"
      ],
      "source": "anilibria",
      "description": "Подростки пилотируют биомеханических роботов «Евангелион» для защиты Токио-3 от Ангелов."
    },
    {
      "id": "anilibria_hells_paradise",
      "title": "Адский рай",
      "original_title": "Jigokuraku",
      "poster": "https://image.tmdb.org/t/p/w500/gsBwgwaW1YWHrQYbVymarruw1yN.jpg",
      "year": "2023",
      "rating": 8.4,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Боевик",
        "Фэнтези"
      ],
      "source": "anilibria",
      "description": "Ниндзя Габимару отправляется на загадочный райский остров в поисках эликсира бессмертия."
    },
    {
      "id": "anilibria_cyberpunk_anime",
      "title": "Киберпанк: Бегущие по краю",
      "original_title": "Cyberpunk: Edgerunners",
      "poster": "https://image.tmdb.org/t/p/w500/bQLrHIRNEkE3PdIWQrZH9Q0vYv.jpg",
      "year": "2022",
      "rating": 8.8,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Фантастика",
        "Боевик"
      ],
      "source": "anilibria",
      "description": "Дэвид теряет всё в Найт-Сити и имплантирует себе военный экзоскелет, став эджраннером."
    },
    {
      "id": "anilibria_bleach",
      "title": "Блич",
      "original_title": "Bleach",
      "poster": "https://image.tmdb.org/t/p/w500/bxWVzZ6oq5SdUBOcG74IavUlHGd.jpg",
      "year": "2004",
      "rating": 8.7,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Боевик",
        "Сверхъестественное"
      ],
      "source": "anilibria",
      "description": "Куросаки Ичиго случайно получает силу проводника душ и защищает мир живых от Пустых."
    },
    {
      "id": "anilibria_berserk",
      "title": "Берсерк",
      "original_title": "Kenpuu Denki Berserk",
      "poster": "https://image.tmdb.org/t/p/w500/92Ds0hOHObvZBekqneimrGpxyXh.jpg",
      "year": "1997",
      "rating": 9.1,
      "quality": "4K Ultra HD",
      "is4K": true,
      "media_type": "anime-series",
      "category": "Аниме",
      "genres": [
        "Аниме",
        "Тёмное фэнтези",
        "Боевик"
      ],
      "source": "anilibria",
      "description": "Одинокий мечник Гатс вступает в отряд наемников «Банда Ястреба» под началом харизматичного Гриффита."
    }
  ]
};

export function getCategoryFallback(category = "new") {
  const normCat = category === "home" ? "popular" : category;

  try {
    const row = db.prepare(
      "SELECT data_json FROM media_cache WHERE cache_key LIKE ? AND length(data_json) > 100 ORDER BY expires_at DESC LIMIT 1"
    ).get("catalog_" + normCat + "_%");

    if (row && row.data_json) {
      const parsed = JSON.parse(row.data_json);
      const items = Array.isArray(parsed) ? parsed : (parsed.items || []);
      if (Array.isArray(items) && items.length > 0) {
        return items;
      }
    }
  } catch (err) {
    console.warn("[FallbackCatalog] Ошибка SQLite:", err.message);
  }

  const matched = VERIFIED_CATALOG_FALLBACK[normCat] || VERIFIED_CATALOG_FALLBACK["popular"] || [];
  return [...matched];
}
