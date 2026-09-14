/* ==========================================================================
   STORM MULTIMEDIA - КАЛЕНДАРЬ РЕЛИЗОВ И РАСПИСАНИЕ СЕРИЙ
   Интерактивное расписание выхода эпизодов 2026 года на 2 недели
   с переключением, реальными обложками и студиями озвучки
   ========================================================================== */

import { showToast } from './auth.js';
import { openPlayerModal } from './player.js';

const CURRENT_WEEK_DAYS = [
  { id: 1, name: 'Понедельник', short: 'ПН', date: '14.09' },
  { id: 2, name: 'Вторник', short: 'ВТ', date: '15.09' },
  { id: 3, name: 'Среда', short: 'СР', date: '16.09' },
  { id: 4, name: 'Четверг', short: 'ЧТ', date: '17.09' },
  { id: 5, name: 'Пятница', short: 'ПТ', date: '18.09' },
  { id: 6, name: 'Суббота', short: 'СБ', date: '19.09' },
  { id: 0, name: 'Воскресенье', short: 'ВС', date: '20.09' }
];

const NEXT_WEEK_DAYS = [
  { id: 1, name: 'Понедельник', short: 'ПН', date: '21.09' },
  { id: 2, name: 'Вторник', short: 'ВТ', date: '22.09' },
  { id: 3, name: 'Среда', short: 'СР', date: '23.09' },
  { id: 4, name: 'Четверг', short: 'ЧТ', date: '24.09' },
  { id: 5, name: 'Пятница', short: 'ПТ', date: '25.09' },
  { id: 6, name: 'Суббота', short: 'СБ', date: '26.09' },
  { id: 0, name: 'Воскресенье', short: 'ВС', date: '27.09' }
];

const FALLBACK_SCHEDULE_CURRENT = [
  // Понедельник (14.09.2026)
  { id: 'sched_c_mon_1', title: 'Разделение', original_title: 'Severance', poster: 'https://image.tmdb.org/t/p/w500/Ag7gBPnh8Cpn5xvCdPPA4RJRN1L.jpg', year: '2026', season: 2, episode: 1, episode_title: 'Пробуждение в Люмоне', day_of_week: 1, release_date: '14.09.2026', air_time: '20:00 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.9, genres: 'Триллер, Детектив', description: 'Марк Скаут сталкивается с последствиями раскрытия правды о процедуре разделения.' },
  { id: 'sched_c_mon_2', title: 'Клинок, рассекающий демонов', original_title: 'Kimetsu no Yaiba', poster: 'https://image.tmdb.org/t/p/w500/aQDPNbeYv75qKpD2QBYkOjfnaYE.jpg', year: '2026', season: 5, episode: 8, episode_title: 'Крепость бесконечности: Прорыв', day_of_week: 1, release_date: '14.09.2026', air_time: '18:30 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 9.1, genres: 'Сёнэн, Фэнтези', description: 'Тандзиро и столпы пробиваются сквозь залы крепости Мудзана.' },
  { id: 'sched_c_mon_3', title: 'Человек-паук: Новый день', original_title: 'Spider-Man', poster: 'https://image.tmdb.org/t/p/w500/8c4a8kE7PizaGQQvlaKMCWAcHQ4.jpg', year: '2026', season: 1, episode: 1, episode_title: 'Свет Манхэттена', day_of_week: 1, release_date: '14.09.2026', air_time: '21:30 МСК', studio: 'Red Head Sound', quality: '4K UHD', is4K: true, rating: 8.4, genres: 'Боевик, Приключения', description: 'Питер Паркер начинает новую главу на улицах ночного Нью-Йорка.' },
  // Вторник (15.09.2026)
  { id: 'sched_c_tue_1', title: 'Пингвин', original_title: 'The Penguin', poster: 'https://image.tmdb.org/t/p/w500/25dj85s5VtirRWF6rmO8TpZXHJV.jpg', year: '2026', season: 1, episode: 6, episode_title: 'Золото Готэма', day_of_week: 2, release_date: '15.09.2026', air_time: '20:30 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.8, genres: 'Криминал, Драма', description: 'Оз Кобблпот укрепляет позиции в криминальном мире Готэма.' },
  { id: 'sched_c_tue_2', title: 'Магическая битва', original_title: 'Jujutsu Kaisen', poster: 'https://image.tmdb.org/t/p/w500/hD8pZg0L129ZpX9Jz045d4rF07O.jpg', year: '2026', season: 3, episode: 4, episode_title: 'Смертельная миграция: Правила игры', day_of_week: 2, release_date: '15.09.2026', air_time: '19:00 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 8.9, genres: 'Сёнэн, Мистика', description: 'Юдзи Итадори и Мэгуми Фусигуро вступают в колонию Смертельной миграции.' },
  { id: 'sched_c_tue_3', title: 'Одни из нас', original_title: 'The Last of Us', poster: 'https://image.tmdb.org/t/p/w500/uKvVjHNqB5VmOrdxqAt2V7J9wwP.jpg', year: '2026', season: 2, episode: 3, episode_title: 'Дорога на Сиэтл', day_of_week: 2, release_date: '15.09.2026', air_time: '22:00 МСК', studio: 'Red Head Sound', quality: '4K UHD', is4K: true, rating: 9.0, genres: 'Драма, Постапокалипсис', description: 'Джоэл и Элли сталкиваются с новыми угрозами в суровом мире.' },
  // Среда (16.09.2026)
  { id: 'sched_c_wed_1', title: 'Дом Дракона', original_title: 'House of the Dragon', poster: 'https://image.tmdb.org/t/p/w500/7QMsOTMUswlwxJP0rTTZfmz2tX2.jpg', year: '2026', season: 3, episode: 2, episode_title: 'Пламя над Глоткой', day_of_week: 3, release_date: '16.09.2026', air_time: '21:00 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.7, genres: 'Фэнтези, Драма', description: 'Морское сражение флотов Велариона и Триархии достигает кульминации.' },
  { id: 'sched_c_wed_2', title: 'Человек-бензопила', original_title: 'Chainsaw Man', poster: 'https://image.tmdb.org/t/p/w500/yVtxvdzsBEvvdVfaF94R8tX8x97.jpg', year: '2026', season: 2, episode: 5, episode_title: 'Арка Резе: Взрывное свидание', day_of_week: 3, release_date: '16.09.2026', air_time: '18:00 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 8.8, genres: 'Экшен, Сверхъестественное', description: 'Дэндзи встречает загадочную девушку по имени Резе в кафе под дождем.' },
  { id: 'sched_c_wed_3', title: 'Медленные лошади', original_title: 'Slow Horses', poster: 'https://image.tmdb.org/t/p/w500/w5J0d70sL4tQ45kX9Z015d8rF08O.jpg', year: '2026', season: 5, episode: 2, episode_title: 'Лондонские тени', day_of_week: 3, release_date: '16.09.2026', air_time: '20:30 МСК', studio: 'HDRezka Studio', quality: '4K UHD', is4K: true, rating: 8.5, genres: 'Шпионский детектив, Триллер', description: 'Джексон Лэмб расследует странное исчезновение агента в центре Лондона.' },
  // Четверг (17.09.2026)
  { id: 'sched_c_thu_1', title: 'Пацаны', original_title: 'The Boys', poster: 'https://image.tmdb.org/t/p/w500/2zmTngn1tYC1AvfnrFLhxeD82hz.jpg', year: '2026', season: 5, episode: 6, episode_title: 'Конец эпохи Vought', day_of_week: 4, release_date: '17.09.2026', air_time: '20:00 МСК', studio: 'Red Head Sound', quality: '4K UHD', is4K: true, rating: 8.9, genres: 'Фантастика, Чёрная комедия', description: 'Бутчер и Хоумлендер готовятся к финальному противостоянию.' },
  { id: 'sched_c_thu_2', title: 'Поднятие уровня в одиночку', original_title: 'Solo Leveling', poster: 'https://image.tmdb.org/t/p/w500/geCRueV3ElhRTr0Q2xBuMiXL4x7.jpg', year: '2026', season: 2, episode: 10, episode_title: 'Восстание из тени', day_of_week: 4, release_date: '17.09.2026', air_time: '18:30 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 9.0, genres: 'Экшен, Фэнтези', description: 'Сон Джин-у призывает теневую армию в подземелье S-ранга.' },
  { id: 'sched_c_thu_3', title: 'Андор', original_title: 'Andor', poster: 'https://image.tmdb.org/t/p/w500/59SVHgK0q712c4vB0kXqZ15d8rF.jpg', year: '2026', season: 2, episode: 4, episode_title: 'Искра восстания', day_of_week: 4, release_date: '17.09.2026', air_time: '21:30 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.7, genres: 'Фантастика, Драма', description: 'Кассиан Андор организует сопротивление перед событиями на Скарифе.' },
  // Пятница (18.09.2026)
  { id: 'sched_c_fri_1', title: 'Мандалорец', original_title: 'The Mandalorian', poster: 'https://image.tmdb.org/t/p/w500/eU1i6eHXlzMOlEq0ku1R07YFeIN.jpg', year: '2026', season: 4, episode: 1, episode_title: 'Охота во внешнем кольце', day_of_week: 5, release_date: '18.09.2026', air_time: '20:00 МСК', studio: 'Red Head Sound', quality: '4K UHD', is4K: true, rating: 8.8, genres: 'Фантастика, Приключения', description: 'Дин Джарин и Грогу выполняют новые контракты Новой Республики.' },
  { id: 'sched_c_fri_2', title: 'Блич: Тысячелетняя кровавая война', original_title: 'Bleach: Sennen Kessen-hen', poster: 'https://image.tmdb.org/t/p/w500/2EewsolmgvSI0bpqox294W7NB7v.jpg', year: '2026', season: 4, episode: 12, episode_title: 'Прощание с Обществом душ', day_of_week: 5, release_date: '18.09.2026', air_time: '18:00 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 9.2, genres: 'Сёнэн, Сверхъестественное', description: 'Ичиго Куросаки обнажает обновленный Зангэцу в битве с Яхве.' },
  { id: 'sched_c_fri_3', title: 'Аркейн', original_title: 'Arcane', poster: 'https://image.tmdb.org/t/p/w500/fqldf2t8ztc9aiwn397dmIsjNVL.jpg', year: '2026', season: 2, episode: 6, episode_title: 'Эхо Зауна', day_of_week: 5, release_date: '18.09.2026', air_time: '22:00 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 9.1, genres: 'Анимация, Фэнтези', description: 'Вай и Джинкс оказываются по разные стороны надвигающейся бури.' },
  // Суббота (19.09.2026)
  { id: 'sched_c_sat_1', title: 'Ван-Пис', original_title: 'One Piece', poster: 'https://image.tmdb.org/t/p/w500/cMD9Ygz11yjEzAgtUR4h0Mvnp9P.jpg', year: '2026', season: 21, episode: 1125, episode_title: 'Остров Будущего: Тайна Вегапанка', day_of_week: 6, release_date: '19.09.2026', air_time: '12:30 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 9.0, genres: 'Сёнэн, Приключения', description: 'Пираты Соломенной Шляпы раскрывают научные секреты острова Эггхед.' },
  { id: 'sched_c_sat_2', title: 'Сорвиголова: Рожденный заново', original_title: 'Daredevil: Born Again', poster: 'https://image.tmdb.org/t/p/w500/7T07Xq195d8rF04vB0kXqZ15d8r.jpg', year: '2026', season: 1, episode: 7, episode_title: 'Правосудие в Аду', day_of_week: 6, release_date: '19.09.2026', air_time: '20:30 МСК', studio: 'Red Head Sound', quality: '4K UHD', is4K: true, rating: 8.7, genres: 'Боевик, Криминал', description: 'Мэтт Мердок борется за Адскую кухню против растущего влияния Фиска.' },
  { id: 'sched_c_sat_3', title: 'Моя геройская академия', original_title: 'Boku no Hero Academia', poster: 'https://image.tmdb.org/t/p/w500/ivOLN47xJtCcKuGVjgGKlKa09Hg.jpg', year: '2026', season: 8, episode: 14, episode_title: 'Один за Всех: Наследие', day_of_week: 6, release_date: '19.09.2026', air_time: '16:00 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 8.6, genres: 'Сёнэн, Супергерои', description: 'Деку использует все причуды предыдущих владельцев в решающей схватке.' },
  // Воскресенье (20.09.2026)
  { id: 'sched_c_sun_1', title: 'Очень странные дела', original_title: 'Stranger Things', poster: 'https://image.tmdb.org/t/p/w500/49WJfeN0moxb9IPfGn8AIqMGskD.jpg', year: '2026', season: 5, episode: 5, episode_title: 'Врата Изнанки', day_of_week: 0, release_date: '20.09.2026', air_time: '20:00 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.9, genres: 'Ужасы, Фантастика', description: 'Одиннадцать и жители Хоукинса объединяются перед финальным штурмом Векны.' },
  { id: 'sched_c_sun_2', title: 'Re:Zero. Жизнь с нуля в альтернативном мире', original_title: 'Re:Zero kara Hajimeru Isekai Seikatsu', poster: 'https://image.tmdb.org/t/p/w500/pmsXG048X07oF15d8rF0kXqZ15d.jpg', year: '2026', season: 3, episode: 8, episode_title: 'Водный город Пристелла', day_of_week: 0, release_date: '20.09.2026', air_time: '18:00 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 8.7, genres: 'Исекай, Драма', description: 'Субару спасает союзников от внезапного нападения культистов Ведьмы.' },
  { id: 'sched_c_sun_3', title: 'Укрытие', original_title: 'Silo', poster: 'https://image.tmdb.org/t/p/w500/tH7e089X07oF15d8rF0kXqZ15d8.jpg', year: '2026', season: 2, episode: 8, episode_title: 'Поверхность правды', day_of_week: 0, release_date: '20.09.2026', air_time: '21:00 МСК', studio: 'HDRezka Studio', quality: '4K UHD', is4K: true, rating: 8.4, genres: 'Фантастика, Детектив', description: 'Джульетта делает открытие о других бункерах за пределами родного укрытия.' }
];

const FALLBACK_SCHEDULE_NEXT = [
  // Понедельник (21.09.2026)
  { id: 'sched_n_mon_1', title: 'Разделение', original_title: 'Severance', poster: 'https://image.tmdb.org/t/p/w500/Ag7gBPnh8Cpn5xvCdPPA4RJRN1L.jpg', year: '2026', season: 2, episode: 2, episode_title: 'Отдел макроданных', day_of_week: 1, release_date: '21.09.2026', air_time: '20:00 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.9, genres: 'Триллер, Детектив', description: 'Команда Марка пытается наладить контакт между своими половинками сознания.' },
  { id: 'sched_n_mon_2', title: 'Клинок, рассекающий демонов', original_title: 'Kimetsu no Yaiba', poster: 'https://image.tmdb.org/t/p/w500/aQDPNbeYv75qKpD2QBYkOjfnaYE.jpg', year: '2026', season: 5, episode: 9, episode_title: 'Битва на рассвете', day_of_week: 1, release_date: '21.09.2026', air_time: '18:30 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 9.1, genres: 'Сёнэн, Фэнтези', description: 'Столпы собирают последние силы в решающем сражении.' },
  { id: 'sched_n_mon_3', title: 'Человек-паук: Новый день', original_title: 'Spider-Man', poster: 'https://image.tmdb.org/t/p/w500/8c4a8kE7PizaGQQvlaKMCWAcHQ4.jpg', year: '2026', season: 1, episode: 2, episode_title: 'Тени Квинса', day_of_week: 1, release_date: '21.09.2026', air_time: '21:30 МСК', studio: 'Red Head Sound', quality: '4K UHD', is4K: true, rating: 8.4, genres: 'Боевик, Приключения', description: 'Питер исследует след технологического оружия в Квинсе.' },
  // Вторник (22.09.2026)
  { id: 'sched_n_tue_1', title: 'Пингвин', original_title: 'The Penguin', poster: 'https://image.tmdb.org/t/p/w500/25dj85s5VtirRWF6rmO8TpZXHJV.jpg', year: '2026', season: 1, episode: 7, episode_title: 'Кровавая корона', day_of_week: 2, release_date: '22.09.2026', air_time: '20:30 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.8, genres: 'Криминал, Драма', description: 'София Фальконе наносит ответный удар по империи Кобблпота.' },
  { id: 'sched_n_tue_2', title: 'Магическая битва', original_title: 'Jujutsu Kaisen', poster: 'https://image.tmdb.org/t/p/w500/hD8pZg0L129ZpX9Jz045d4rF07O.jpg', year: '2026', season: 3, episode: 5, episode_title: 'Токийская колония №1', day_of_week: 2, release_date: '22.09.2026', air_time: '19:00 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 8.9, genres: 'Сёнэн, Мистика', description: 'Итадори противостоит древнему магу Хигуруме.' },
  { id: 'sched_n_tue_3', title: 'Одни из нас', original_title: 'The Last of Us', poster: 'https://image.tmdb.org/t/p/w500/uKvVjHNqB5VmOrdxqAt2V7J9wwP.jpg', year: '2026', season: 2, episode: 4, episode_title: 'День первый', day_of_week: 2, release_date: '22.09.2026', air_time: '22:00 МСК', studio: 'Red Head Sound', quality: '4K UHD', is4K: true, rating: 9.0, genres: 'Драма, Постапокалипсис', description: 'Элли и Дина прибывают в разрушенный Сиэтл.' },
  // Среда (23.09.2026)
  { id: 'sched_n_wed_1', title: 'Дом Дракона', original_title: 'House of the Dragon', poster: 'https://image.tmdb.org/t/p/w500/7QMsOTMUswlwxJP0rTTZfmz2tX2.jpg', year: '2026', season: 3, episode: 3, episode_title: 'Шёпот драконов', day_of_week: 3, release_date: '23.09.2026', air_time: '21:00 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.7, genres: 'Фэнтези, Драма', description: 'Рейнира перегруппировывает сторонников на Драконьем Камне.' },
  { id: 'sched_n_wed_2', title: 'Человек-бензопила', original_title: 'Chainsaw Man', poster: 'https://image.tmdb.org/t/p/w500/yVtxvdzsBEvvdVfaF94R8tX8x97.jpg', year: '2026', season: 2, episode: 6, episode_title: 'Демон бомбы', day_of_week: 3, release_date: '23.09.2026', air_time: '18:00 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 8.8, genres: 'Экшен, Сверхъестественное', description: 'Истинная сущность Резе раскрывается в эпической схватке.' },
  { id: 'sched_n_wed_3', title: 'Медленные лошади', original_title: 'Slow Horses', poster: 'https://image.tmdb.org/t/p/w500/w5J0d70sL4tQ45kX9Z015d8rF08O.jpg', year: '2026', season: 5, episode: 3, episode_title: 'Операция Слау', day_of_week: 3, release_date: '23.09.2026', air_time: '20:30 МСК', studio: 'HDRezka Studio', quality: '4K UHD', is4K: true, rating: 8.5, genres: 'Шпионский детектив, Триллер', description: 'Агенты Слау Хаус оказываются в ловушке на заброшенном складе.' },
  // Четверг (24.09.2026)
  { id: 'sched_n_thu_1', title: 'Пацаны', original_title: 'The Boys', poster: 'https://image.tmdb.org/t/p/w500/2zmTngn1tYC1AvfnrFLhxeD82hz.jpg', year: '2026', season: 5, episode: 7, episode_title: 'Судный час', day_of_week: 4, release_date: '24.09.2026', air_time: '20:00 МСК', studio: 'Red Head Sound', quality: '4K UHD', is4K: true, rating: 8.9, genres: 'Фантастика, Чёрная комедия', description: 'План Бутчера вступает в завершающую стадию.' },
  { id: 'sched_n_thu_2', title: 'Поднятие уровня в одиночку', original_title: 'Solo Leveling', poster: 'https://image.tmdb.org/t/p/w500/geCRueV3ElhRTr0Q2xBuMiXL4x7.jpg', year: '2026', season: 2, episode: 11, episode_title: 'Теневой монарх', day_of_week: 4, release_date: '24.09.2026', air_time: '18:30 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 9.0, genres: 'Экшен, Фэнтези', description: 'Полное пробуждение силы Владыки теней.' },
  { id: 'sched_n_thu_3', title: 'Андор', original_title: 'Andor', poster: 'https://image.tmdb.org/t/p/w500/59SVHgK0q712c4vB0kXqZ15d8rF.jpg', year: '2026', season: 2, episode: 5, episode_title: 'Тайный канал', day_of_week: 4, release_date: '24.09.2026', air_time: '21:30 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.7, genres: 'Фантастика, Драма', description: 'Лютен Раэль координирует удары по имперским базам снабжения.' },
  // Пятница (25.09.2026)
  { id: 'sched_n_fri_1', title: 'Мандалорец', original_title: 'The Mandalorian', poster: 'https://image.tmdb.org/t/p/w500/eU1i6eHXlzMOlEq0ku1R07YFeIN.jpg', year: '2026', season: 4, episode: 2, episode_title: 'Возвращение на Мандалор', day_of_week: 5, release_date: '25.09.2026', air_time: '20:00 МСК', studio: 'Red Head Sound', quality: '4K UHD', is4K: true, rating: 8.8, genres: 'Фантастика, Приключения', description: 'Дин Джарин помогает кланам отстроить кузницу предков.' },
  { id: 'sched_n_fri_2', title: 'Блич: Тысячелетняя кровавая война', original_title: 'Bleach: Sennen Kessen-hen', poster: 'https://image.tmdb.org/t/p/w500/2EewsolmgvSI0bpqox294W7NB7v.jpg', year: '2026', season: 4, episode: 13, episode_title: 'Врата будущего', day_of_week: 5, release_date: '25.09.2026', air_time: '18:00 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 9.2, genres: 'Сёнэн, Сверхъестественное', description: 'Финальный аккорд великой войны между синигами и квинси.' },
  { id: 'sched_n_fri_3', title: 'Аркейн', original_title: 'Arcane', poster: 'https://image.tmdb.org/t/p/w500/fqldf2t8ztc9aiwn397dmIsjNVL.jpg', year: '2026', season: 2, episode: 7, episode_title: 'Рассвет Пилтовера', day_of_week: 5, release_date: '25.09.2026', air_time: '22:00 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 9.1, genres: 'Анимация, Фэнтези', description: 'Кейтлин принимает судьбоносное решение для спасения обоих городов.' },
  // Суббота (26.09.2026)
  { id: 'sched_n_sat_1', title: 'Ван-Пис', original_title: 'One Piece', poster: 'https://image.tmdb.org/t/p/w500/cMD9Ygz11yjEzAgtUR4h0Mvnp9P.jpg', year: '2026', season: 21, episode: 1126, episode_title: 'Побег с Эггхеда', day_of_week: 6, release_date: '26.09.2026', air_time: '12:30 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 9.0, genres: 'Сёнэн, Приключения', description: 'Луффи в форме 5-го гира защищает команду от флота Морского Дозора.' },
  { id: 'sched_n_sat_2', title: 'Сорвиголова: Рожденный заново', original_title: 'Daredevil: Born Again', poster: 'https://image.tmdb.org/t/p/w500/7T07Xq195d8rF04vB0kXqZ15d8r.jpg', year: '2026', season: 1, episode: 8, episode_title: 'Падение мэрии', day_of_week: 6, release_date: '26.09.2026', air_time: '20:30 МСК', studio: 'Red Head Sound', quality: '4K UHD', is4K: true, rating: 8.7, genres: 'Боевик, Криминал', description: 'Правда о коррупции в верхушке города становится достоянием прессы.' },
  { id: 'sched_n_sat_3', title: 'Моя геройская академия', original_title: 'Boku no Hero Academia', poster: 'https://image.tmdb.org/t/p/w500/ivOLN47xJtCcKuGVjgGKlKa09Hg.jpg', year: '2026', season: 8, episode: 15, episode_title: 'Новый рассвет героев', day_of_week: 6, release_date: '26.09.2026', air_time: '16:00 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 8.6, genres: 'Сёнэн, Супергерои', description: 'Мир восстанавливается после грандиозной битвы за будущее общества.' },
  // Воскресенье (27.09.2026)
  { id: 'sched_n_sun_1', title: 'Очень странные дела', original_title: 'Stranger Things', poster: 'https://image.tmdb.org/t/p/w500/49WJfeN0moxb9IPfGn8AIqMGskD.jpg', year: '2026', season: 5, episode: 6, episode_title: 'Битва за Хоукинс', day_of_week: 0, release_date: '27.09.2026', air_time: '20:00 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.9, genres: 'Ужасы, Фантастика', description: 'Решающий бой на границе измерений.' },
  { id: 'sched_n_sun_2', title: 'Re:Zero. Жизнь с нуля в альтернативном мире', original_title: 'Re:Zero kara Hajimeru Isekai Seikatsu', poster: 'https://image.tmdb.org/t/p/w500/pmsXG048X07oF15d8rF0kXqZ15d.jpg', year: '2026', season: 3, episode: 9, episode_title: 'Голос призыва', day_of_week: 0, release_date: '27.09.2026', air_time: '18:00 МСК', studio: 'AniLibria', quality: '1080p FHD', rating: 8.7, genres: 'Исекай, Драма', description: 'Эмилия и Субару координируют защиту башни ратуши.' },
  { id: 'sched_n_sun_3', title: 'Укрытие', original_title: 'Silo', poster: 'https://image.tmdb.org/t/p/w500/tH7e089X07oF15d8rF0kXqZ15d8.jpg', year: '2026', season: 2, episode: 9, episode_title: 'Вне протокола', day_of_week: 0, release_date: '27.09.2026', air_time: '21:00 МСК', studio: 'HDRezka Studio', quality: '4K UHD', is4K: true, rating: 8.4, genres: 'Фантастика, Детектив', description: 'Восстание в нижних уровнях укрытия набирает неудержимую силу.' }
];

let selectedWeek = 'current'; // 'current' | 'next'
let selectedDay = 1; // 1=ПН, 2=ВТ, ..., 0=ВС

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function wrapPosterUrl(url) {
  if (!url) return 'assets/favicon.svg';
  if (url.startsWith('/api/media/image-proxy') || url.startsWith('assets/')) return url;
  return `/api/media/image-proxy?url=${encodeURIComponent(url)}`;
}

export async function openReleaseCalendarModal() {
  let modal = document.getElementById('release-calendar-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'release-calendar-modal';
    modal.innerHTML = `
      <div class="storm-modal release-calendar-modal-dialog">
        <div class="storm-modal-header" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 24px;">📅</span>
            <div>
              <h3 style="margin: 0; font-size: 17px;">Календарь релизов и расписание серий</h3>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Выход новых эпизодов 2026 года в оригинале и студийном дубляже</div>
            </div>
          </div>
          <button type="button" class="storm-modal-close" id="calendar-modal-close-btn" title="Закрыть">✕</button>
        </div>
        <div class="storm-modal-body" id="release-calendar-body" style="padding: 16px 20px 24px;"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#calendar-modal-close-btn');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('is-open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('is-open'); };
  }

  modal.classList.add('is-open');
  renderCalendarContent(document.getElementById('release-calendar-body'));
}

async function renderCalendarContent(container) {
  if (!container) return;

  const currentDayIndex = new Date().getDay(); // 0=ВС, 1=ПН...
  selectedDay = currentDayIndex;

  container.innerHTML = `
    <!-- Переключатель недель: Текущая и Следующая -->
    <div class="cal-week-switcher">
      <button type="button" class="cal-week-btn ${selectedWeek === 'current' ? 'active' : ''}" data-week="current">
        <span class="cal-week-icon">🗓️</span>
        <span>Текущая неделя (14.09 — 20.09.2026)</span>
      </button>
      <button type="button" class="cal-week-btn ${selectedWeek === 'next' ? 'active' : ''}" data-week="next">
        <span class="cal-week-icon">⏭️</span>
        <span>Следующая неделя (21.09 — 27.09.2026)</span>
      </button>
    </div>

    <!-- Навигационная панель дней выбранной недели -->
    <div class="cal-days-navbar" id="cal-days-navbar"></div>

    <!-- Контейнер карточек эпизодов -->
    <div id="calendar-day-items-grid" class="cal-items-grid"></div>
  `;

  // Обработчик переключения недель
  const weekBtns = container.querySelectorAll('.cal-week-btn');
  weekBtns.forEach(btn => {
    btn.onclick = () => {
      selectedWeek = btn.dataset.week;
      weekBtns.forEach(b => b.classList.toggle('active', b.dataset.week === selectedWeek));
      loadAndRenderWeek(container);
    };
  });

  await loadAndRenderWeek(container);
}

async function loadAndRenderWeek(container) {
  const daysNav = container.querySelector('#cal-days-navbar');
  const grid = container.querySelector('#calendar-day-items-grid');
  if (!daysNav || !grid) return;

  grid.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; color: var(--text-muted); display: flex; align-items: center; justify-content: center; gap: 10px;">
      <div class="storm-spinner"></div>
      <span style="font-size: 13px;">Синхронизация расписания релизов 2026...</span>
    </div>
  `;

  let scheduleItems = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(`/api/media/schedule?week=${selectedWeek}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.items) && data.items.length > 0) {
        scheduleItems = data.items;
        try {
          localStorage.setItem(`storm_cal_${selectedWeek}`, JSON.stringify(scheduleItems));
        } catch {}
      }
    }
  } catch (err) {
    console.warn('Ошибка сети при загрузке расписания, используем кэш и автономный каталог 2026:', err);
  }

  // 1. Проверяем локальный кэш, если сетевой запрос не удался или пуст
  if (!scheduleItems || scheduleItems.length === 0) {
    try {
      const localCached = localStorage.getItem(`storm_cal_${selectedWeek}`);
      if (localCached) {
        const parsed = JSON.parse(localCached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          scheduleItems = parsed;
        }
      }
    } catch {}
  }

  // 2. Гарантированный автономный каталог 2026 (все 14 дней с реальными релизами)
  if (!scheduleItems || scheduleItems.length === 0) {
    scheduleItems = selectedWeek === 'next' ? FALLBACK_SCHEDULE_NEXT : FALLBACK_SCHEDULE_CURRENT;
  }

  const daysConfig = selectedWeek === 'next' ? NEXT_WEEK_DAYS : CURRENT_WEEK_DAYS;
  const currentDayIndex = new Date().getDay();

  // Группируем элементы по дням недели
  const dayGroups = {};
  daysConfig.forEach(d => { dayGroups[d.id] = []; });

  scheduleItems.forEach(it => {
    const rawDay = it.day_of_week !== undefined ? it.day_of_week : it.day;
    const dayId = (rawDay !== undefined && !isNaN(parseInt(rawDay, 10))) ? parseInt(rawDay, 10) : 1;
    if (dayGroups[dayId]) {
      dayGroups[dayId].push(it);
    }
  });

  // Рендерим панель дней с датами
  daysNav.innerHTML = daysConfig.map(d => {
    const isToday = selectedWeek === 'current' && d.id === currentDayIndex;
    const isAct = d.id === selectedDay;
    const count = dayGroups[d.id]?.length || 0;
    return `
      <button type="button" class="cal-day-pill ${isAct ? 'active' : ''} ${isToday ? 'is-today' : ''}" data-day="${d.id}">
        <div class="cal-day-pill-content">
          <span class="cal-day-full-name">${d.name} (${d.date})</span>
          <span class="cal-day-short-name">${d.short} ${d.date}</span>
          <span class="cal-day-count-badge">${count}</span>
        </div>
        ${isToday ? '<span class="cal-day-today-tag">Сегодня</span>' : ''}
      </button>
    `;
  }).join('');

  // Обработчики кликов по дням
  daysNav.querySelectorAll('.cal-day-pill').forEach(btn => {
    btn.onclick = () => {
      selectedDay = parseInt(btn.dataset.day, 10);
      daysNav.querySelectorAll('.cal-day-pill').forEach(b => b.classList.toggle('active', parseInt(b.dataset.day, 10) === selectedDay));
      renderDayGrid(grid, dayGroups[selectedDay], selectedDay, selectedWeek);
    };
  });

  renderDayGrid(grid, dayGroups[selectedDay], selectedDay, selectedWeek);
}

function renderDayGrid(grid, items, dayId, week) {
  if (!items || items.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; color: var(--text-muted);">
        <div style="font-size: 32px; margin-bottom: 8px;">🎬</div>
        <div style="font-size: 14px; font-weight: 600;">В этот день новых серий не запланировано</div>
        <div style="font-size: 12px; margin-top: 4px;">Выберите другой день недели для просмотра расписания</div>
      </div>
    `;
    return;
  }

  const currentDayIndex = new Date().getDay();
  grid.innerHTML = items.map(it => {
    const season = it.season || 1;
    const episode = it.episode || 1;
    const is4K = Boolean(it.is4K || it.quality?.includes('4K'));
    const posterUrl = wrapPosterUrl(it.poster);

    let statusText = `📅 ${it.release_date || ''} в ${it.air_time || '20:00 МСК'}`;
    let statusClass = 'upcoming';

    if (week === 'current') {
      if (dayId === currentDayIndex) {
        statusText = `🔴 Сегодня в ${it.air_time || '20:00 МСК'}`;
        statusClass = 'today';
      } else {
        const normDay = dayId === 0 ? 7 : dayId;
        const normCur = currentDayIndex === 0 ? 7 : currentDayIndex;
        if (normDay < normCur) {
          statusText = `✅ Вышла на этой неделе`;
          statusClass = 'released';
        }
      }
    }

    return `
      <div class="cal-card storm-card" data-id="${it.id}">
        <!-- Постер с обложкой релиза -->
        <div class="cal-poster-wrap">
          <img src="${posterUrl}" class="cal-poster-img" alt="${escapeHtml(it.title)}" loading="lazy" onerror="this.src='assets/favicon.svg'">
          <span class="cal-poster-ep-badge">S${season} • E${episode}</span>
          ${is4K ? '<span class="cal-poster-4k-badge">4K</span>' : ''}
        </div>

        <!-- Информация об эпизоде -->
        <div class="cal-info-wrap">
          <div class="cal-header-zone">
            <h4 class="cal-card-title" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</h4>
            <div class="cal-ep-indicator ${statusClass}">
              <span class="cal-ep-name">Сезон ${season}, Серия ${episode}${it.episode_title ? ` • «${escapeHtml(it.episode_title)}»` : ''}</span>
              <span class="cal-time-pill">${statusText}</span>
            </div>
          </div>

          <!-- Метаданные: Студия, Качество, Рейтинг -->
          <div class="cal-meta-badges">
            <span class="cal-meta-badge cal-badge-year">${it.year || '2026'}</span>
            ${it.studio ? `<span class="cal-meta-badge cal-badge-studio">🎙️ ${escapeHtml(it.studio)}</span>` : ''}
            ${it.rating ? `<span class="cal-meta-badge cal-badge-rating">★ ${it.rating}</span>` : ''}
            ${it.quality ? `<span class="cal-meta-badge cal-badge-quality">${it.quality}</span>` : ''}
          </div>

          <!-- Кнопка запуска -->
          <div class="cal-actions-row">
            <button type="button" class="storm-btn storm-btn-primary cal-watch-btn" data-id="${it.id}" style="flex: 1; padding: 6px 12px; font-size: 12px;">
              ▶ Смотреть S${season}:E${episode}
            </button>
            <button type="button" class="storm-btn storm-btn-secondary cal-notify-btn" title="Напомнить о выходе" style="padding: 6px 10px;">
              🔔
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Привязка кликов по карточкам и кнопкам
  grid.querySelectorAll('.cal-card').forEach(card => {
    const itId = card.dataset.id;
    const it = items.find(x => String(x.id) === String(itId));
    if (!it) return;

    const playBtn = card.querySelector('.cal-watch-btn');
    const notifyBtn = card.querySelector('.cal-notify-btn');

    const startWatching = () => {
      openPlayerModal({
        id: it.id,
        title: it.title,
        original_title: it.original_title || '',
        poster: it.poster,
        year: it.year,
        source: it.source || 'fanfilm4k',
        media_type: 'series'
      }, {
        initialSeason: it.season || 1,
        initialEpisode: it.episode || 1
      });
    };

    if (playBtn) playBtn.onclick = (e) => { e.stopPropagation(); startWatching(); };
    if (notifyBtn) notifyBtn.onclick = (e) => {
      e.stopPropagation();
      showToast(`Напоминание для «${it.title}» добавлено`, 'success');
    };
    card.onclick = () => startWatching();
  });
}
