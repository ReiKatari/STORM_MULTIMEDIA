import { db } from "../db.js";

export const VERIFIED_CATALOG_FALLBACK = {
  new: [
    {
      id: "82529",
      title: "Человек-паук: Новый день",
      original_title: "Spider-Man: Brand New Day",
      poster: "https://image.tmdb.org/t/p/w500/a393c5c3e031a0e88a385ec5446baea8.jpg",
      year: "2026",
      rating: 8.5,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "movie",
      category: "Фильм",
      genres: ["Фантастика", "Боевик", "Приключения"],
      source: "fanfilm4k",
      url: "https://v17.fanfilm4k.media/82529-chelovek-pauk-novyj-den-film.html",
      description: "Питер Паркер сталкивается с последствиями стертой памяти мира и новыми угрозами Нью-Йорка в новой эре."
    },
    {
      id: "lostfilm_gentlemen",
      title: "Джентльмены",
      original_title: "The Gentlemen",
      poster: "https://image.tmdb.org/t/p/w500/vbpA5L3n6z720aGSm5U1QZ2VqXG.jpg",
      year: "2024",
      rating: 8.2,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "series",
      category: "Сериал",
      genres: ["Криминал", "Комедия", "Боевик"],
      source: "lostfilm",
      description: "Эдди Холстед наследует крупное поместье отца и неожиданно узнает, что оно является частью масштабной каннабис-империи."
    },
    {
      id: "tmdb_dune2",
      title: "Дюна: Часть вторая",
      original_title: "Dune: Part Two",
      poster: "https://image.tmdb.org/t/p/w500/czembW0RJJ1rboOmCY2eo9NjhbL.jpg",
      year: "2024",
      rating: 8.7,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "movie",
      category: "Фильм",
      genres: ["Фантастика", "Приключения", "Драма"],
      source: "tmdb",
      description: "Пол Атрейдес объединяется с Чани и фременами, чтобы отомстить заговорщикам, уничтожившим его семью."
    },
    {
      id: "lostfilm_penguin",
      title: "Пингвин",
      original_title: "The Penguin",
      poster: "https://image.tmdb.org/t/p/w500/a393c5c3e031a0e88a385ec5446baea8.jpg",
      year: "2024",
      rating: 8.8,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "series",
      category: "Сериал",
      genres: ["Криминал", "Драма"],
      source: "lostfilm",
      description: "Освальд Кобблпот стремится захватить власть в криминальном мире Готэма после событий фильма «Бэтмен»."
    },
    {
      id: "tmdb_gladiator2",
      title: "Гладиатор 2",
      original_title: "Gladiator II",
      poster: "https://image.tmdb.org/t/p/w500/2cxhvwyEwRlysAmRH4iodkvo0z5.jpg",
      year: "2024",
      rating: 7.9,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "movie",
      category: "Фильм",
      genres: ["Боевик", "Приключения", "Драма"],
      source: "tmdb",
      description: "Спустя годы после гибели Максимуса повзрослевший Луций вынужден выйти на арену Колизея во имя свободы Рима."
    },
    {
      id: "lostfilm_shogun",
      title: "Сёгун",
      original_title: "Shōgun",
      poster: "https://image.tmdb.org/t/p/w500/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg",
      year: "2024",
      rating: 8.9,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "series",
      category: "Сериал",
      genres: ["Драма", "История", "Военный"],
      source: "lostfilm",
      description: "В Японии начала XVII века английский штурман Джон Блэкторн оказывается втянут в смертельную борьбу феодальных кланов."
    },
    {
      id: "rhs_arcane2",
      title: "Аркейн (2 сезон)",
      original_title: "Arcane Season 2",
      poster: "https://image.tmdb.org/t/p/w500/fqldf2t8ztc9aiwn397rWW2vAwh.jpg",
      year: "2024",
      rating: 9.1,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "cartoon-series",
      category: "Мультсериал",
      genres: ["Фантастика", "Боевик", "Драма"],
      source: "redheadsound",
      description: "Кульминация противостояния городов-близнецов Пилтовера и Зауна и сестер Вай и Джинкс."
    },
    {
      id: "anilibria_solo_leveling2",
      title: "Поднятие уровня в одиночку (2 сезон)",
      original_title: "Solo Leveling: Arise from the Shadow",
      poster: "https://image.tmdb.org/t/p/w500/geCRueV3ElhRTr0xtJuqoJ8UQOW.jpg",
      year: "2025",
      rating: 8.6,
      quality: "1080p FHD",
      is4K: false,
      media_type: "anime-series",
      category: "Аниме",
      genres: ["Фэнтези", "Боевик", "Приключения"],
      source: "anilibria",
      description: "Сон Джин-у продолжает открывать тайны системы охотников и восходит на вершину теневого владычества."
    },
    {
      id: "tmdb_deadpool_wolverine",
      title: "Дэдпул и Росомаха",
      original_title: "Deadpool & Wolverine",
      poster: "https://image.tmdb.org/t/p/w500/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg",
      year: "2024",
      rating: 8.1,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "movie",
      category: "Фильм",
      genres: ["Боевик", "Комедия", "Фантастика"],
      source: "tmdb",
      description: "Уэйд Уилсон объединяется с угрюмым Росомахой из альтернативной вселенной для спасения мультивселенной."
    },
    {
      id: "lostfilm_fallout",
      title: "Фоллаут",
      original_title: "Fallout",
      poster: "https://image.tmdb.org/t/p/w500/AnsZu4h0V7u0C8x4A1V7M8p2kL4.jpg",
      year: "2024",
      rating: 8.5,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "series",
      category: "Сериал",
      genres: ["Фантастика", "Приключения", "Боевик"],
      source: "lostfilm",
      description: "Выходцы из безопасных подземных Убежищ сталкиваются с жестоким и причудливым миром постапокалиптической Пустоши."
    },
    {
      id: "tmdb_wild_robot",
      title: "Дикий робот",
      original_title: "The Wild Robot",
      poster: "https://image.tmdb.org/t/p/w500/9w0Vh9CuAcTvbvAo2QJH2qpq0Me.jpg",
      year: "2024",
      rating: 8.5,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "cartoons",
      category: "Мультфильм",
      genres: ["Мультфильм", "Фантастика", "Семейный"],
      source: "tmdb",
      description: "Робот ROZZUM 7134 терпит крушение на необитаемом острове и учится дружить с дикими животными."
    },
    {
      id: "lostfilm_silo2",
      title: "Укрытие (2 сезон)",
      original_title: "Silo Season 2",
      poster: "https://image.tmdb.org/t/p/w500/6A7r9bW0u0vYV80FjA4M0k8mKxZ.jpg",
      year: "2024",
      rating: 8.3,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "series",
      category: "Сериал",
      genres: ["Фантастика", "Драма", "Триллер"],
      source: "lostfilm",
      description: "Джульетта делает опасный шаг за пределы шлюза и открывает пугающую правду о десятках других бункеров."
    }
  ],

  movies: [
    {
      id: "82529",
      title: "Человек-паук: Новый день",
      original_title: "Spider-Man: Brand New Day",
      poster: "https://image.tmdb.org/t/p/w500/a393c5c3e031a0e88a385ec5446baea8.jpg",
      year: "2026",
      rating: 8.5,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "movie",
      category: "Фильм",
      genres: ["Фантастика", "Боевик"],
      source: "fanfilm4k",
      url: "https://v17.fanfilm4k.media/82529-chelovek-pauk-novyj-den-film.html",
      description: "Новая глава приключений Питера Паркера в потрясающем качестве 4K Ultra HD."
    },
    {
      id: "tmdb_dune2",
      title: "Дюна: Часть вторая",
      original_title: "Dune: Part Two",
      poster: "https://image.tmdb.org/t/p/w500/czembW0RJJ1rboOmCY2eo9NjhbL.jpg",
      year: "2024",
      rating: 8.7,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "movie",
      category: "Фильм",
      genres: ["Фантастика", "Приключения"],
      source: "tmdb",
      description: "Грандиозный научно-фантастический эпос Дени Вильнёва."
    },
    {
      id: "tmdb_oppenheimer",
      title: "Оппенгеймер",
      original_title: "Oppenheimer",
      poster: "https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
      year: "2023",
      rating: 8.9,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "movie",
      category: "Фильм",
      genres: ["Драма", "История", "Биография"],
      source: "tmdb",
      description: "История жизни американского физика Роберта Оппенгеймера и создания первой атомной бомбы."
    },
    {
      id: "tmdb_interstellar",
      title: "Интерстеллар",
      original_title: "Interstellar",
      poster: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
      year: "2014",
      rating: 8.7,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "movie",
      category: "Фильм",
      genres: ["Фантастика", "Драма", "Приключения"],
      source: "tmdb",
      description: "Команда исследователей отправляется сквозь червоточину в поисках нового дома для человечества."
    },
    {
      id: "tmdb_deadpool_wolverine",
      title: "Дэдпул и Росомаха",
      original_title: "Deadpool & Wolverine",
      poster: "https://image.tmdb.org/t/p/w500/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg",
      year: "2024",
      rating: 8.1,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "movie",
      category: "Фильм",
      genres: ["Боевик", "Комедия"],
      source: "tmdb",
      description: "Взрывной супергеройский дуэт двух легендарных персонажей."
    },
    {
      id: "tmdb_gladiator2",
      title: "Гладиатор 2",
      original_title: "Gladiator II",
      poster: "https://image.tmdb.org/t/p/w500/2cxhvwyEwRlysAmRH4iodkvo0z5.jpg",
      year: "2024",
      rating: 7.9,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "movie",
      category: "Фильм",
      genres: ["Боевик", "Драма"],
      source: "tmdb",
      description: "Возвращение в Колизей Древнего Рима."
    }
  ],

  series: [
    {
      id: "lostfilm_gentlemen",
      title: "Джентльмены",
      original_title: "The Gentlemen",
      poster: "https://image.tmdb.org/t/p/w500/vbpA5L3n6z720aGSm5U1QZ2VqXG.jpg",
      year: "2024",
      rating: 8.2,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "series",
      category: "Сериал",
      genres: ["Криминал", "Комедия"],
      source: "lostfilm",
      description: "Стильный криминальный сериал Гая Ричи."
    },
    {
      id: "lostfilm_penguin",
      title: "Пингвин",
      original_title: "The Penguin",
      poster: "https://image.tmdb.org/t/p/w500/a393c5c3e031a0e88a385ec5446baea8.jpg",
      year: "2024",
      rating: 8.8,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "series",
      category: "Сериал",
      genres: ["Криминал", "Драма"],
      source: "lostfilm",
      description: "Колин Фаррелл в роли безжалостного криминального авторитета Готэма."
    },
    {
      id: "lostfilm_shogun",
      title: "Сёгун",
      original_title: "Shōgun",
      poster: "https://image.tmdb.org/t/p/w500/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg",
      year: "2024",
      rating: 8.9,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "series",
      category: "Сериал",
      genres: ["Драма", "История"],
      source: "lostfilm",
      description: "Масштабная историческая драма о феодальной Японии."
    },
    {
      id: "lostfilm_fallout",
      title: "Фоллаут",
      original_title: "Fallout",
      poster: "https://image.tmdb.org/t/p/w500/AnsZu4h0V7u0C8x4A1V7M8p2kL4.jpg",
      year: "2024",
      rating: 8.5,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "series",
      category: "Сериал",
      genres: ["Фантастика", "Боевик"],
      source: "lostfilm",
      description: "Культовая игровая вселенная оживает на экранах."
    },
    {
      id: "lostfilm_the_boys",
      title: "Пацаны",
      original_title: "The Boys",
      poster: "https://image.tmdb.org/t/p/w500/2zmTngn1tYC1AvfnNDBpQI4r4Q8.jpg",
      year: "2024",
      rating: 8.7,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "series",
      category: "Сериал",
      genres: ["Боевик", "Фантастика", "Комедия"],
      source: "lostfilm",
      description: "Отряд мстителей противостоит зарвавшимся корпоративным супергероям."
    }
  ],

  cartoons: [
    {
      id: "tmdb_wild_robot",
      title: "Дикий робот",
      original_title: "The Wild Robot",
      poster: "https://image.tmdb.org/t/p/w500/9w0Vh9CuAcTvbvAo2QJH2qpq0Me.jpg",
      year: "2024",
      rating: 8.5,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "cartoons",
      category: "Мультфильм",
      genres: ["Мультфильм", "Семейный"],
      source: "tmdb",
      description: "Трогательная история робота на необитаемом острове."
    },
    {
      id: "tmdb_inside_out_2",
      title: "Головоломка 2",
      original_title: "Inside Out 2",
      poster: "https://image.tmdb.org/t/p/w500/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg",
      year: "2024",
      rating: 8.0,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "cartoons",
      category: "Мультфильм",
      genres: ["Мультфильм", "Комедия"],
      source: "tmdb",
      description: "Новые эмоции взрослеющей Райли в продолжении шедевра Pixar."
    },
    {
      id: "tmdb_spider_verse",
      title: "Человек-паук: Паутина вселенных",
      original_title: "Spider-Man: Across the Spider-Verse",
      poster: "https://image.tmdb.org/t/p/w500/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg",
      year: "2023",
      rating: 8.8,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "cartoons",
      category: "Мультфильм",
      genres: ["Мультфильм", "Боевик"],
      source: "tmdb",
      description: "Майлз Моралес путешествует по мультивселенной пауков."
    }
  ],

  "cartoon-series": [
    {
      id: "rhs_arcane2",
      title: "Аркейн",
      original_title: "Arcane",
      poster: "https://image.tmdb.org/t/p/w500/fqldf2t8ztc9aiwn397rWW2vAwh.jpg",
      year: "2024",
      rating: 9.1,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "cartoon-series",
      category: "Мультсериал",
      genres: ["Фантастика", "Боевик"],
      source: "redheadsound",
      description: "Визуальный шедевр по вселенной League of Legends."
    },
    {
      id: "fanfilm_rick_morty",
      title: "Рик и Морти",
      original_title: "Rick and Morty",
      poster: "https://image.tmdb.org/t/p/w500/gdI672992I9x7ioAJOxHgvJW4eD.jpg",
      year: "2023",
      rating: 8.9,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "cartoon-series",
      category: "Мультсериал",
      genres: ["Комедия", "Фантастика"],
      source: "fanfilm4k",
      description: "Безумные межгалактические приключения дедушки-гения и его внука."
    }
  ],

  "anime-movies": [
    {
      id: "shiki_boy_heron",
      title: "Мальчик и птица",
      original_title: "Kimitachi wa Dou Ikiru ka",
      poster: "https://image.tmdb.org/t/p/w500/jDQPkg0KDZhPQjNxMPz5vH0G2Xw.jpg",
      year: "2023",
      rating: 8.5,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "anime-movies",
      category: "Аниме",
      genres: ["Аниме", "Приключения", "Фэнтези"],
      source: "shikimori",
      description: "Оскароносная анимационная картина Хаяо Миядзаки."
    },
    {
      id: "shiki_your_name",
      title: "Твоё имя",
      original_title: "Kimi no Na wa.",
      poster: "https://image.tmdb.org/t/p/w500/q719jXXEzOoYaps6qFsxWa93oMm.jpg",
      year: "2016",
      rating: 8.9,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "anime-movies",
      category: "Аниме",
      genres: ["Аниме", "Романтика", "Драма"],
      source: "shikimori",
      description: "Шедевр Макото Синкая о связи сквозь время и пространство."
    }
  ],

  "anime-series": [
    {
      id: "anilibria_solo_leveling2",
      title: "Поднятие уровня в одиночку",
      original_title: "Solo Leveling",
      poster: "https://image.tmdb.org/t/p/w500/geCRueV3ElhRTr0xtJuqoJ8UQOW.jpg",
      year: "2025",
      rating: 8.6,
      quality: "1080p FHD",
      is4K: false,
      media_type: "anime-series",
      category: "Аниме",
      genres: ["Аниме", "Боевик", "Фэнтези"],
      source: "anilibria",
      description: "Путь слабейшего охотника человечества к вершине могущества."
    },
    {
      id: "anilibria_demon_slayer",
      title: "Клинок, рассекающий демонов",
      original_title: "Kimetsu no Yaiba",
      poster: "https://image.tmdb.org/t/p/w500/xUfRZu2mi8jH6SzQEJGP6tjBuYj.jpg",
      year: "2024",
      rating: 8.8,
      quality: "4K Ultra HD",
      is4K: true,
      media_type: "anime-series",
      category: "Аниме",
      genres: ["Аниме", "Боевик", "Сёнэн"],
      source: "anilibria",
      description: "Танджиро Камадо сражается с высшими демонами ради спасения сестры."
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

  const matched = VERIFIED_CATALOG_FALLBACK[normCat] || VERIFIED_CATALOG_FALLBACK["new"] || [];
  return [...matched];
}
