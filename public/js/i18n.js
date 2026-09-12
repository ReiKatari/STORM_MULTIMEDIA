/* ==========================================================================
   STORM MULTIMEDIA - СИСТЕМА ЛОКАЛИЗАЦИИ (100% FULL LOCALIZATION)
   Поддержка 6 основных языков: RU, EN, DE, FR, ZH, JA
   Строгое соблюдение Sentence case и запрет символа &
   ========================================================================== */

export const translations = {
  ru: {
    brand_title: "STORM MULTIMEDIA",
    brand_sub: "Кино, сериалы и аниме",
    search_placeholder: "Поиск фильмов, сериалов и аниме...",
    tab_home: "Главная",
    tab_new: "Новинки",
    tab_movies: "Фильмы",
    tab_series: "Сериалы",
    tab_cartoons: "Мультфильмы",
    tab_cartoon_series: "Мультсериалы",
    tab_anime_movies: "Аниме-фильмы",
    tab_anime_series: "Аниме-сериалы",
    tab_continue: "Продолжить просмотр",
    tab_bookmarks: "Мои списки и закладки",
    
    // Источники и виды
    source_all: "Все источники",
    source_fanfilm: "FanFilm4K (4K Ultra HD)",
    source_tmdb: "TMDB (Мировое кино)",
    source_anixart: "AniXart (Аниме и озвучки)",
    source_anilibria: "AniLibria (Аниме Full HD)",
    source_shikimori: "Shikimori (База аниме)",
    source_kodik: "Kodik (Аниме и сериалы)",
    source_hdrezka: "HDRezka (Кино и дубляж)",
    source_collaps: "Collaps (Онлайн-плеер)",
    source_alloha: "Alloha TV (Кинотеатр)",
    source_videocdn: "Videocdn (Премьеры)",
    source_ashdi: "Ashdi (Мультистриминг)",
    source_kinobox: "Kinobox (Мульти-плеер)",
    view_grid: "Сетка",
    view_compact_grid: "Компактная сетка",
    view_detailed_list: "Детальный список",
    view_table: "Таблица",
    
    // Сортировка
    sort_popular: "По популярности",
    sort_rating: "По рейтингу",
    sort_date: "По дате добавления",
    sort_name: "По названию",
    
    // Фильтры
    filters_toggle: "Фильтры",
    filter_genre: "Жанр",
    filter_all_genres: "Все жанры",
    filter_year: "Год выпуска",
    filter_min_rating: "Минимальный рейтинг",
    filter_reset: "Сбросить фильтры",
    
    // Статусы просмотра
    status_watching: "Смотрю",
    status_plan: "В планах",
    status_completed: "Просмотрено",
    status_hold: "Отложено",
    status_dropped: "Брошено",
    status_favorite: "Любимое",
    
    // Аутентификация
    auth_login: "Вход",
    auth_register: "Регистрация",
    auth_logout: "Выход",
    auth_profile: "Мой профиль",
    auth_username: "Имя пользователя",
    auth_email: "Электронная почта",
    auth_password: "Пароль",
    auth_login_submit: "Войти в аккаунт",
    auth_register_submit: "Зарегистрироваться",
    auth_no_account: "Ещё нет аккаунта?",
    auth_have_account: "Уже есть аккаунт?",
    
    // Профиль и статистика
    stats_total_hours: "Часов просмотра",
    stats_bookmarks: "Всего в закладках",
    stats_completed: "Завершено",
    stats_watching: "В процессе",
    stats_custom_lists: "Своих списков",
    
    // Плеер и медиа
    player_4k_title: "4K Ultra HD плеер",
    player_kinobox_title: "Мультиплеер Kinobox",
    player_anixart_title: "AniXart аниме плеер",
    player_trailer_title: "Официальный трейлер",
    player_voiceover: "Озвучка",
    player_series: "Серия",
    player_season: "Сезон",
    player_progress: "Прогресс просмотра",
    add_to_list: "Добавить в список",
    create_new_list: "Создать новый список",
    list_title_placeholder: "Название списка...",
    list_desc_placeholder: "Описание коллекции...",
    btn_create: "Создать",
    btn_cancel: "Отмена",
    btn_save: "Сохранить",
    btn_delete: "Удалить",
    
    // Таблица
    col_poster: "Постер",
    col_title: "Название",
    col_type: "Тип",
    col_year: "Год",
    col_rating: "Рейтинг",
    col_status: "Статус",
    col_progress: "Прогресс",
    col_actions: "Действия",
    
    // Сообщения
    msg_bookmark_saved: "Закладка успешно обновлена",
    msg_list_created: "Список успешно создан",
    msg_added_to_list: "Добавлено в список",
    msg_login_success: "Вы успешно вошли в систему",
    msg_logout_success: "Вы вышли из системы",
    empty_history: "История просмотров пока пуста",
    empty_bookmarks: "В этом разделе пока нет закладок"
  },

  en: {
    brand_title: "STORM MULTIMEDIA",
    brand_sub: "Movies, series and anime",
    search_placeholder: "Search movies, TV series and anime...",
    tab_home: "Home",
    tab_new: "New releases",
    tab_movies: "Movies",
    tab_series: "TV series",
    tab_cartoons: "Cartoons",
    tab_cartoon_series: "Animated series",
    tab_anime_movies: "Anime movies",
    tab_anime_series: "Anime series",
    tab_continue: "Continue watching",
    tab_bookmarks: "My lists and bookmarks",
    
    source_all: "All sources",
    source_fanfilm: "FanFilm4K (4K Ultra HD)",
    source_tmdb: "TMDB (World cinema)",
    source_anixart: "AniXart (Anime and dubbing)",
    source_anilibria: "AniLibria (Anime Full HD)",
    source_shikimori: "Shikimori (Anime base)",
    source_kodik: "Kodik (Anime and series)",
    source_hdrezka: "HDRezka (Cinema and dubbing)",
    source_collaps: "Collaps (Online player)",
    source_alloha: "Alloha TV (Cinema)",
    source_videocdn: "Videocdn (Premieres)",
    source_ashdi: "Ashdi (Multi-stream)",
    source_kinobox: "Kinobox (Multi-player)",
    view_grid: "Grid",
    view_compact_grid: "Compact grid",
    view_detailed_list: "Detailed list",
    view_table: "Table",
    
    sort_popular: "By popularity",
    sort_rating: "By rating",
    sort_date: "By release date",
    sort_name: "By title",
    
    filters_toggle: "Filters",
    filter_genre: "Genre",
    filter_all_genres: "All genres",
    filter_year: "Release year",
    filter_min_rating: "Minimum rating",
    filter_reset: "Reset filters",
    
    status_watching: "Watching",
    status_plan: "Plan to watch",
    status_completed: "Completed",
    status_hold: "On hold",
    status_dropped: "Dropped",
    status_favorite: "Favorite",
    
    auth_login: "Sign in",
    auth_register: "Sign up",
    auth_logout: "Sign out",
    auth_profile: "My profile",
    auth_username: "Username",
    auth_email: "Email address",
    auth_password: "Password",
    auth_login_submit: "Sign in to account",
    auth_register_submit: "Create account",
    auth_no_account: "Do not have an account?",
    auth_have_account: "Already have an account?",
    
    stats_total_hours: "Hours watched",
    stats_bookmarks: "Total bookmarks",
    stats_completed: "Completed",
    stats_watching: "In progress",
    stats_custom_lists: "Custom lists",
    
    player_4k_title: "4K Ultra HD player",
    player_kinobox_title: "Kinobox multi-player",
    player_anixart_title: "AniXart anime player",
    player_trailer_title: "Official trailer",
    player_voiceover: "Voice acting",
    player_series: "Episode",
    player_season: "Season",
    player_progress: "Watch progress",
    add_to_list: "Add to list",
    create_new_list: "Create new list",
    list_title_placeholder: "List title...",
    list_desc_placeholder: "Collection description...",
    btn_create: "Create",
    btn_cancel: "Cancel",
    btn_save: "Save",
    btn_delete: "Delete",
    
    col_poster: "Poster",
    col_title: "Title",
    col_type: "Type",
    col_year: "Year",
    col_rating: "Rating",
    col_status: "Status",
    col_progress: "Progress",
    col_actions: "Actions",
    
    msg_bookmark_saved: "Bookmark updated successfully",
    msg_list_created: "List created successfully",
    msg_added_to_list: "Added to list",
    msg_login_success: "You have signed in successfully",
    msg_logout_success: "You have signed out",
    empty_history: "Watch history is currently empty",
    empty_bookmarks: "No bookmarks in this section yet"
  },

  de: {
    brand_title: "STORM MULTIMEDIA",
    brand_sub: "Filme, Serien und Anime",
    search_placeholder: "Filme, Serien und Anime suchen...",
    tab_home: "Startseite",
    tab_new: "Neuheiten",
    tab_movies: "Filme",
    tab_series: "Serien",
    tab_cartoons: "Zeichentrick",
    tab_cartoon_series: "Zeichentrickserien",
    tab_anime_movies: "Anime-Filme",
    tab_anime_series: "Anime-Serien",
    tab_continue: "Weiterschauen",
    tab_bookmarks: "Meine Listen und Lesezeichen",
    
    source_all: "Alle Quellen",
    source_fanfilm: "FanFilm4K (4K Ultra HD)",
    source_tmdb: "TMDB (Weltkino)",
    source_anixart: "AniXart (Anime und Dub)",
    source_anilibria: "AniLibria (Anime Full HD)",
    source_shikimori: "Shikimori (Anime-Datenbank)",
    source_kodik: "Kodik (Anime und Serien)",
    source_hdrezka: "HDRezka (Kino und Dub)",
    source_collaps: "Collaps (Online-Player)",
    source_alloha: "Alloha TV (Kino)",
    source_videocdn: "Videocdn (Premieren)",
    source_ashdi: "Ashdi (Multi-Stream)",
    source_kinobox: "Kinobox (Multi-Player)",
    view_grid: "Gitter",
    view_compact_grid: "Kompaktes Gitter",
    view_detailed_list: "Detaillierte Liste",
    view_table: "Tabelle",
    
    sort_popular: "Nach Beliebtheit",
    sort_rating: "Nach Bewertung",
    sort_date: "Nach Datum",
    sort_name: "Nach Titel",
    
    filters_toggle: "Filter",
    filter_genre: "Genre",
    filter_all_genres: "Alle Genres",
    filter_year: "Erscheinungsjahr",
    filter_min_rating: "Mindestbewertung",
    filter_reset: "Filter zurücksetzen",
    
    status_watching: "Am Schauen",
    status_plan: "Geplant",
    status_completed: "Abgeschlossen",
    status_hold: "Pausiert",
    status_dropped: "Abgebrochen",
    status_favorite: "Favorit",
    
    auth_login: "Anmelden",
    auth_register: "Registrieren",
    auth_logout: "Abmelden",
    auth_profile: "Mein Profil",
    auth_username: "Benutzername",
    auth_email: "E-Mail-Adresse",
    auth_password: "Passwort",
    auth_login_submit: "Konto anmelden",
    auth_register_submit: "Konto erstellen",
    auth_no_account: "Noch kein Konto?",
    auth_have_account: "Bereits ein Konto?",
    
    stats_total_hours: "Stunden geschaut",
    stats_bookmarks: "Lesezeichen gesamt",
    stats_completed: "Abgeschlossen",
    stats_watching: "In Arbeit",
    stats_custom_lists: "Eigene Listen",
    
    player_4k_title: "4K Ultra HD Player",
    player_kinobox_title: "Kinobox Multi-Player",
    player_anixart_title: "AniXart Anime Player",
    player_trailer_title: "Offizieller Trailer",
    player_voiceover: "Synchronisation",
    player_series: "Episode",
    player_season: "Staffel",
    player_progress: "Wiedergabefortschritt",
    add_to_list: "Zur Liste hinzufügen",
    create_new_list: "Neue Liste erstellen",
    list_title_placeholder: "Listentitel...",
    list_desc_placeholder: "Sammlungsbeschreibung...",
    btn_create: "Erstellen",
    btn_cancel: "Abbrechen",
    btn_save: "Speichern",
    btn_delete: "Löschen",
    
    col_poster: "Poster",
    col_title: "Titel",
    col_type: "Typ",
    col_year: "Jahr",
    col_rating: "Bewertung",
    col_status: "Status",
    col_progress: "Fortschritt",
    col_actions: "Aktionen",
    
    msg_bookmark_saved: "Lesezeichen erfolgreich aktualisiert",
    msg_list_created: "Liste erfolgreich erstellt",
    msg_added_to_list: "Zur Liste hinzugefügt",
    msg_login_success: "Erfolgreich angemeldet",
    msg_logout_success: "Erfolgreich abgemeldet",
    empty_history: "Der Wiedergabeverlauf ist noch leer",
    empty_bookmarks: "Noch keine Lesezeichen in diesem Bereich"
  },

  fr: {
    brand_title: "STORM MULTIMEDIA",
    brand_sub: "Films, séries et animés",
    search_placeholder: "Rechercher des films, séries et animés...",
    tab_home: "Accueil",
    tab_new: "Nouveautés",
    tab_movies: "Films",
    tab_series: "Séries",
    tab_cartoons: "Dessins animés",
    tab_cartoon_series: "Séries animées",
    tab_anime_movies: "Films d'animation",
    tab_anime_series: "Séries d'animation",
    tab_continue: "Reprendre la lecture",
    tab_bookmarks: "Mes listes et favoris",
    
    source_all: "Toutes les sources",
    source_fanfilm: "FanFilm4K (4K Ultra HD)",
    source_tmdb: "TMDB (Cinéma mondial)",
    source_anixart: "AniXart (Anime et doublage)",
    source_anilibria: "AniLibria (Anime Full HD)",
    source_shikimori: "Shikimori (Base d'anime)",
    source_kodik: "Kodik (Anime et séries)",
    source_hdrezka: "HDRezka (Cinéma et doublage)",
    source_collaps: "Collaps (Lecteur en ligne)",
    source_alloha: "Alloha TV (Cinéma)",
    source_videocdn: "Videocdn (Premières)",
    source_ashdi: "Ashdi (Multi-diffusion)",
    source_kinobox: "Kinobox (Multi-lecteur)",
    view_grid: "Grille",
    view_compact_grid: "Grille compacte",
    view_detailed_list: "Liste détaillée",
    view_table: "Tableau",
    
    sort_popular: "Par popularité",
    sort_rating: "Par note",
    sort_date: "Par date d'ajout",
    sort_name: "Par titre",
    
    filters_toggle: "Filtres",
    filter_genre: "Genre",
    filter_all_genres: "Tous les genres",
    filter_year: "Année de sortie",
    filter_min_rating: "Note minimale",
    filter_reset: "Réinitialiser les filtres",
    
    status_watching: "En cours",
    status_plan: "À voir",
    status_completed: "Terminé",
    status_hold: "En pause",
    status_dropped: "Abandonné",
    status_favorite: "Favori",
    
    auth_login: "Connexion",
    auth_register: "Inscription",
    auth_logout: "Déconnexion",
    auth_profile: "Mon profil",
    auth_username: "Nom d'utilisateur",
    auth_email: "Adresse courriel",
    auth_password: "Mot de passe",
    auth_login_submit: "Se connecter",
    auth_register_submit: "Créer un compte",
    auth_no_account: "Pas encore de compte?",
    auth_have_account: "Vous avez déjà un compte?",
    
    stats_total_hours: "Heures visionnées",
    stats_bookmarks: "Total des favoris",
    stats_completed: "Terminés",
    stats_watching: "En cours",
    stats_custom_lists: "Listes personnalisées",
    
    player_4k_title: "Lecteur 4K Ultra HD",
    player_kinobox_title: "Multi-lecteur Kinobox",
    player_anixart_title: "Lecteur animé AniXart",
    player_trailer_title: "Bande-annonce officielle",
    player_voiceover: "Doublage",
    player_series: "Épisode",
    player_season: "Saison",
    player_progress: "Progression de lecture",
    add_to_list: "Ajouter à la liste",
    create_new_list: "Créer une nouvelle liste",
    list_title_placeholder: "Titre de la liste...",
    list_desc_placeholder: "Description de la collection...",
    btn_create: "Créer",
    btn_cancel: "Annuler",
    btn_save: "Enregistrer",
    btn_delete: "Supprimer",
    
    col_poster: "Affiche",
    col_title: "Titre",
    col_type: "Type",
    col_year: "Année",
    col_rating: "Note",
    col_status: "Statut",
    col_progress: "Progression",
    col_actions: "Actions",
    
    msg_bookmark_saved: "Favori mis à jour avec succès",
    msg_list_created: "Liste créée avec succès",
    msg_added_to_list: "Ajouté à la liste",
    msg_login_success: "Connexion réussie",
    msg_logout_success: "Vous êtes déconnecté",
    empty_history: "L'historique de visionnage est vide",
    empty_bookmarks: "Aucun favori dans cette section pour l'instant"
  },

  zh: {
    brand_title: "STORM MULTIMEDIA",
    brand_sub: "电影、剧集与动画",
    search_placeholder: "搜索电影、剧集和动画...",
    tab_home: "首页",
    tab_new: "最新上线",
    tab_movies: "电影",
    tab_series: "电视剧",
    tab_cartoons: "动画片",
    tab_cartoon_series: "系列动画片",
    tab_anime_movies: "动画电影",
    tab_anime_series: "日本动画剧集",
    tab_continue: "继续观看",
    tab_bookmarks: "我的列表与收藏",
    
    source_all: "所有片源",
    source_fanfilm: "FanFilm4K (4K超高清)",
    source_tmdb: "TMDB (全球电影)",
    source_anixart: "AniXart (动漫与配音)",
    source_anilibria: "AniLibria (全高清动漫)",
    source_shikimori: "Shikimori (动漫数据库)",
    source_kodik: "Kodik (动漫与剧集)",
    source_hdrezka: "HDRezka (影视与配音)",
    source_collaps: "Collaps (在线播放器)",
    source_alloha: "Alloha TV (影院)",
    source_videocdn: "Videocdn (首映影视)",
    source_ashdi: "Ashdi (流媒体播放)",
    source_kinobox: "Kinobox (万能多源播放器)",
    view_grid: "网格视图",
    view_compact_grid: "紧凑网格",
    view_detailed_list: "详细列表",
    view_table: "表格视图",
    
    sort_popular: "按热度排序",
    sort_rating: "按评分排序",
    sort_date: "按更新时间",
    sort_name: "按标题排序",
    
    filters_toggle: "筛选器",
    filter_genre: "类型",
    filter_all_genres: "所有类型",
    filter_year: "上映年份",
    filter_min_rating: "最低评分",
    filter_reset: "重置筛选",
    
    status_watching: "在看",
    status_plan: "想看",
    status_completed: "已看",
    status_hold: "搁置",
    status_dropped: "抛弃",
    status_favorite: "特别喜爱",
    
    auth_login: "登录",
    auth_register: "注册",
    auth_logout: "退出登录",
    auth_profile: "个人中心",
    auth_username: "用户名",
    auth_email: "电子邮箱",
    auth_password: "密码",
    auth_login_submit: "登录账户",
    auth_register_submit: "创建新账户",
    auth_no_account: "还没有账户？",
    auth_have_account: "已有账户？",
    
    stats_total_hours: "观看小时数",
    stats_bookmarks: "收藏总数",
    stats_completed: "已完成",
    stats_watching: "正在观看",
    stats_custom_lists: "自定义列表",
    
    player_4k_title: "4K 超清播放器",
    player_kinobox_title: "Kinobox 综合播放器",
    player_anixart_title: "AniXart 动画播放器",
    player_trailer_title: "官方预告片",
    player_voiceover: "配音版本",
    player_series: "集数",
    player_season: "季数",
    player_progress: "观看进度",
    add_to_list: "加入列表",
    create_new_list: "创建新列表",
    list_title_placeholder: "列表名称...",
    list_desc_placeholder: "合集描述...",
    btn_create: "创建",
    btn_cancel: "取消",
    btn_save: "保存",
    btn_delete: "删除",
    
    col_poster: "海报",
    col_title: "名称",
    col_type: "类型",
    col_year: "年份",
    col_rating: "评分",
    col_status: "状态",
    col_progress: "进度",
    col_actions: "操作",
    
    msg_bookmark_saved: "收藏状态已更新",
    msg_list_created: "列表已成功创建",
    msg_added_to_list: "已添加至列表",
    msg_login_success: "登录成功",
    msg_logout_success: "已退出系统",
    empty_history: "暂无观看历史记录",
    empty_bookmarks: "该栏目下暂无收藏内容"
  },

  ja: {
    brand_title: "STORM MULTIMEDIA",
    brand_sub: "映画、ドラマとアニメ",
    search_placeholder: "映画、ドラマ、アニメを検索...",
    tab_home: "ホーム",
    tab_new: "新作",
    tab_movies: "映画",
    tab_series: "ドラマ",
    tab_cartoons: "カートゥーン",
    tab_cartoon_series: "アニメシリーズ",
    tab_anime_movies: "アニメ映画",
    tab_anime_series: "アニメTVシリーズ",
    tab_continue: "続きを見る",
    tab_bookmarks: "リストとブックマーク",
    
    source_all: "すべてのソース",
    source_fanfilm: "FanFilm4K (4K Ultra HD)",
    source_tmdb: "TMDB (世界映画)",
    source_anixart: "AniXart (アニメと吹替)",
    source_anilibria: "AniLibria (Full HDアニメ)",
    source_shikimori: "Shikimori (アニメベース)",
    source_kodik: "Kodik (アニメとドラマ)",
    source_hdrezka: "HDRezka (映画と吹替)",
    source_collaps: "Collaps (オンラインプレイヤー)",
    source_alloha: "Alloha TV (シアター)",
    source_videocdn: "Videocdn (プレミア)",
    source_ashdi: "Ashdi (マルチストリーミング)",
    source_kinobox: "Kinobox (マルチプレイヤー)",
    view_grid: "グリッド",
    view_compact_grid: "コンパクトグリッド",
    view_detailed_list: "詳細リスト",
    view_table: "テーブル",
    
    sort_popular: "人気順",
    sort_rating: "評価順",
    sort_date: "追加日順",
    sort_name: "タイトル順",
    
    filters_toggle: "フィルター",
    filter_genre: "ジャンル",
    filter_all_genres: "全ジャンル",
    filter_year: "公開年",
    filter_min_rating: "最低評価",
    filter_reset: "リセット",
    
    status_watching: "視聴中",
    status_plan: "視聴予定",
    status_completed: "視聴完了",
    status_hold: "保留中",
    status_dropped: "中断",
    status_favorite: "お気に入り",
    
    auth_login: "ログイン",
    auth_register: "新規登録",
    auth_logout: "ログアウト",
    auth_profile: "マイプロフィール",
    auth_username: "ユーザー名",
    auth_email: "メールアドレス",
    auth_password: "パスワード",
    auth_login_submit: "ログインする",
    auth_register_submit: "アカウント作成",
    auth_no_account: "アカウントをお持ちでない方",
    auth_have_account: "すでにアカウントをお持ちの方",
    
    stats_total_hours: "総視聴時間（時間）",
    stats_bookmarks: "ブックマーク総数",
    stats_completed: "完了した作品",
    stats_watching: "視聴中の作品",
    stats_custom_lists: "カスタムリスト",
    
    player_4k_title: "4K Ultra HD プレーヤー",
    player_kinobox_title: "Kinobox マルチプレーヤー",
    player_anixart_title: "AniXart アニメプレーヤー",
    player_trailer_title: "公式予告編",
    player_voiceover: "吹替・字幕",
    player_series: "エピソード",
    player_season: "シーズン",
    player_progress: "再生進捗",
    add_to_list: "リストに追加",
    create_new_list: "新規リスト作成",
    list_title_placeholder: "リスト名...",
    list_desc_placeholder: "説明...",
    btn_create: "作成",
    btn_cancel: "キャンセル",
    btn_save: "保存",
    btn_delete: "削除",
    
    col_poster: "ポスター",
    col_title: "タイトル",
    col_type: "種別",
    col_year: "年",
    col_rating: "評価",
    col_status: "ステータス",
    col_progress: "進捗",
    col_actions: "操作",
    
    msg_bookmark_saved: "ブックマークを更新しました",
    msg_list_created: "リストを作成しました",
    msg_added_to_list: "リストに追加しました",
    msg_login_success: "ログインしました",
    msg_logout_success: "ログアウトしました",
    empty_history: "視聴履歴はありません",
    empty_bookmarks: "このセクションにはまだ作品がありません"
  }
};

let currentLang = localStorage.getItem('storm_lang') || 'ru';

export function getLanguage() {
  return currentLang;
}

export function setLanguage(lang) {
  if (translations[lang]) {
    currentLang = lang;
    localStorage.setItem('storm_lang', lang);
    document.documentElement.lang = lang;
    applyTranslations();
  }
}

export function t(key) {
  const dict = translations[currentLang] || translations.ru;
  return dict[key] || translations.ru[key] || key;
}

export function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

export function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = t(key);
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      el.placeholder = t(key);
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      el.title = t(key);
    }
  });
}
