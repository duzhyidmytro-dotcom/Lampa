/*!
 * Smart Netflix Engine for Lampa — smart_netflix_engine.js
 * Універсальний самонавчальний рушій рекомендацій + менеджер профілів.
 *
 *  - Без жодних «зашитих» смаків: жанри, теги (TMDB keywords), десятиліття
 *    й антипатії вивчаються лише з історії та дій активного користувача.
 *  - Ряди додаються зверху головної (index 0..8) через Lampa.ContentRows,
 *    нативні ряди Lampa не видаляються. Кожен ряд можна вимкнути в
 *    Налаштування → Ряди на головній.
 *  - Профілі: «Профіль 1», «Профіль 2», «Разом (Для двох)».
 *  - Синхронізація між пристроями — через Lampa.Favorite (CUB).
 *
 * Сумісність: ES5 (Android TV WebView), без Promise / стрілок / let.
 */
(function () {
    'use strict';

    if (window.smart_netflix_engine_loaded) return;
    window.smart_netflix_engine_loaded = true;

    var VERSION = '1.0.0';
    var DAY = 24 * 60 * 60 * 1000;
    var SESSION = now();

    // ------------------------------------------------------------------
    // Налаштування алгоритму
    // ------------------------------------------------------------------
    var W = {
        completed: 5.0,   // percent >= 75, like, viewed
        progress: 2.5,    // 20 <= percent < 75
        abandoned: -4.0,  // 0 < percent < 15 і давніше 5 днів
        thrown: -4.0,     // «Кинуто»
        look: 2.5,        // «Дивлюсь» / «Продовжено»
        book: 1.5,        // закладки, «Пізніше», «Заплановано»
        history: 1.0,     // просто відкривали картку
        act_viewed: 3.0,  // «Вже бачив»
        act_hide: -4.0,   // «Не цікавить»
        act_more: 6.0     // «Більше схожого»
    };

    var DUO_BOOST = 1.8;        // підсилення перетину смаків у режимі «Разом»
    var VETO = -3.0;            // поріг «сильно не подобається»
    var PROFILER_BATCH = 5;     // скільки нових тайтлів профілювати за один показ головної
    var IMPRESSION_LIMIT = 4;   // показів без реакції до «паузи»
    var COOLDOWN_DAYS = 14;     // тривалість паузи
    var ROW_SIZE = 20;          // карток у ряду
    var ROW_TIMEOUT = 15000;    // страховка: ряд завжди повертається

    var KEYS = {
        active: 'smart_engine_active',
        profiles: 'smart_engine_profiles',
        impressions: 'smart_engine_impressions',
        meta: 'smart_engine_meta',
        state: 'smart_engine_state'
    };

    var PROFILE_LABEL = {
        p1: '👤 Профіль 1',
        p2: '👤 Профіль 2',
        duo: '👥 Разом (Для двох)'
    };

    var HEAD_LABEL = {
        p1: '👤 Профіль 1',
        p2: '👤 Профіль 2',
        duo: '👥 Разом'
    };

    // Жанри TMDB українською (кіно + серіали)
    var GENRE_UA = {
        28: 'Бойовик', 12: 'Пригоди', 16: 'Анімація', 35: 'Комедія', 80: 'Кримінал',
        99: 'Документальне', 18: 'Драма', 10751: 'Сімейне', 14: 'Фентезі', 36: 'Історичне',
        27: 'Жахи', 10402: 'Музика', 9648: 'Детектив', 10749: 'Мелодрама', 878: 'Фантастика',
        10770: 'Телефільм', 53: 'Трилер', 10752: 'Воєнне', 37: 'Вестерн',
        10759: 'Екшн і пригоди', 10762: 'Дитяче', 10763: 'Новини', 10764: 'Реаліті',
        10765: 'Фантастика і фентезі', 10766: 'Мильна опера', 10767: 'Ток-шоу', 10768: 'Війна і політика'
    };

    // Популярні ключові слова TMDB українською (інші показуються англійською)
    var KEYWORD_UA = {
        'based on novel or book': 'за книгою', 'based on comic': 'за коміксом', 'based on manga': 'за мангою',
        'based on true story': 'на реальних подіях', 'biography': 'біографія', 'superhero': 'супергерої',
        'dystopia': 'антиутопія', 'time travel': 'подорожі в часі', 'space': 'космос',
        'artificial intelligence (a.i.)': 'штучний інтелект', 'artificial intelligence': 'штучний інтелект',
        'robot': 'роботи', 'alien': 'прибульці', 'zombie': 'зомбі', 'vampire': 'вампіри',
        'serial killer': 'серійний вбивця', 'revenge': 'помста', 'heist': 'пограбування',
        'murder': 'вбивство', 'detective': 'детектив', 'police': 'поліція', 'spy': 'шпигуни',
        'survival': 'виживання', 'post-apocalyptic future': 'постапокаліпсис', 'apocalypse': 'апокаліпсис',
        'dark comedy': 'чорна комедія', 'romantic comedy': 'романтична комедія',
        'coming of age': 'дорослішання', 'high school': 'школа', 'friendship': 'дружба',
        'family': 'сім\'я', 'love': 'кохання', 'magic': 'магія', 'dragon': 'дракони',
        'sequel': 'сиквел', 'remake': 'рімейк', 'anime': 'аніме', 'psychological thriller': 'психологічний трилер',
        'conspiracy': 'змова', 'mafia': 'мафія', 'gangster': 'гангстери', 'drug cartel': 'наркокартель',
        'prison': 'в\'язниця', 'war': 'війна', 'world war ii': 'Друга світова', 'courtroom': 'суд',
        'lawyer': 'юристи', 'hospital': 'лікарня', 'doctor': 'лікарі', 'sports': 'спорт', 'boxing': 'бокс',
        'martial arts': 'бойові мистецтва', 'cyberpunk': 'кіберпанк', 'parallel world': 'паралельні світи',
        'supernatural': 'надприродне', 'haunted house': 'будинок із привидами', 'demon': 'демони',
        'witch': 'відьми', 'monster': 'монстри', 'slasher': 'слешер', 'found footage': 'знайдений запис',
        'mockumentary': 'псевдодокументалка', 'miniseries': 'мінісеріал', 'sitcom': 'ситком',
        'female protagonist': 'головна героїня', 'small town': 'маленьке місто', 'road trip': 'подорож',
        'treasure hunt': 'пошук скарбів', 'pirate': 'пірати', 'medieval': 'середньовіччя',
        'kingdom': 'королівства', 'politics': 'політика', 'corruption': 'корупція',
        'investigation': 'розслідування', 'kidnapping': 'викрадення', 'hostage': 'заручники',
        'assassin': 'найманці', 'hitman': 'кілер', 'car race': 'перегони', 'video game': 'відеоігри',
        'virtual reality': 'віртуальна реальність', 'satire': 'сатира', 'parody': 'пародія',
        'musical': 'мюзикл', 'teenager': 'підлітки', 'anthology': 'антологія', 'twist ending': 'несподіваний фінал',
        'psychopath': 'психопат', 'time loop': 'часова петля', 'mystery': 'таємниця', 'survival horror': 'хорор виживання',
        'post-apocalyptic': 'постапокаліпсис', 'alien invasion': 'вторгнення прибульців', 'cult': 'секта',
        'spaceship': 'космічний корабель', 'mutant': 'мутанти', 'military': 'армія', 'cold war': 'холодна війна',
        'historical drama': 'історична драма', 'period drama': 'костюмна драма', 'workplace comedy': 'офісна комедія',
        'hacker': 'хакери', 'fbi': 'ФБР', 'cia': 'ЦРУ', 'escape': 'втеча', 'betrayal': 'зрада', 'mythology': 'міфологія'
    };

    // Технічні теги, що не говорять про смак
    var KEYWORD_STOP = {
        'aftercreditsstinger': 1, 'duringcreditsstinger': 1, 'woman director': 1, '3d': 1, 'imax': 1
    };

    // Канонізація: серіальні жанри → кіно-еквіваленти (щоб смак переносився між типами)
    var TV_TO_CANON = { 10759: [28, 12], 10765: [878, 14], 10768: [10752], 10762: [10751] };
    var CANON_TO_TV = { 28: 10759, 12: 10759, 878: 10765, 14: 10765, 10752: 10768, 16: 16, 35: 35, 80: 80, 99: 99, 18: 18, 10751: 10751, 9648: 9648, 37: 37, 10763: 10763, 10764: 10764, 10766: 10766, 10767: 10767 };
    var MOVIE_GENRES = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770, 53, 10752, 37];
    var TV_ONLY_NOISE = [10763, 10767]; // новини й ток-шоу ховаються, якщо юзер сам їх не любить

    var FAV_TYPES = ['history', 'like', 'book', 'wath', 'look', 'viewed', 'thrown', 'scheduled', 'continued'];

    // ------------------------------------------------------------------
    // Дрібні утиліти (ES5)
    // ------------------------------------------------------------------
    function now() { return new Date().getTime(); }

    function log() {
        try {
            var a = ['[SmartEngine]'];
            for (var i = 0; i < arguments.length; i++) a.push(arguments[i]);
            console.log.apply(console, a);
        } catch (e) { }
    }

    function each(obj, fn) {
        if (!obj) return;
        for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) fn(k, obj[k]);
    }

    function has(arr, v) { return !!arr && arr.indexOf(v) >= 0; }

    function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

    function rand(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

    function shuffle(arr) {
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
    }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    function dateStr(time) {
        var d = new Date(time);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function today(shiftDays) { return dateStr(now() + (shiftDays || 0) * DAY); }

    function once(fn) {
        var done = false;
        return function () {
            if (done) return;
            done = true;
            return fn.apply(this, arguments);
        };
    }

    function addParam(url, part) { return url + (url.indexOf('?') >= 0 ? '&' : '?') + part; }

    function buildPath(path, query) {
        var u = path;
        each(query || {}, function (k, v) {
            if (v === '' || v === null || typeof v === 'undefined') return;
            u = addParam(u, k + '=' + v);
        });
        return u;
    }

    function weightedPick(list, weightFn) {
        var total = 0, i;
        for (i = 0; i < list.length; i++) total += Math.max(0.0001, weightFn(list[i]));
        var r = Math.random() * total;
        for (i = 0; i < list.length; i++) {
            r -= Math.max(0.0001, weightFn(list[i]));
            if (r <= 0) return list[i];
        }
        return list[list.length - 1];
    }

    // Паралельний запуск задач з одним фінальним колбеком
    function join(tasks, done) {
        var left = tasks.length;
        if (!left) return done();
        var finish = function () { left--; if (left === 0) done(); };
        for (var i = 0; i < tasks.length; i++) {
            (function (task) {
                var cb = once(finish);
                try { task(cb); } catch (e) { log('task error', e); cb(); }
            })(tasks[i]);
        }
    }

    // ------------------------------------------------------------------
    // Сховище
    // ------------------------------------------------------------------
    function storeGet(name, def) {
        var v;
        try { v = Lampa.Storage.get(name, ''); } catch (e) { v = ''; }
        return v && typeof v === 'object' ? v : def;
    }

    var saveTimers = {};
    function persist(name, value) {
        clearTimeout(saveTimers[name]);
        saveTimers[name] = setTimeout(function () {
            try { Lampa.Storage.set(name, value, true); } catch (e) { log('save error', name, e); }
        }, 500);
    }

    var profiles, impressions, meta, state;

    function emptyProfile() {
        return { manual: {}, opened: {}, genres: {}, keywords: {}, decades: {}, updated: 0 };
    }

    function loadStore() {
        profiles = storeGet(KEYS.profiles, {});
        if (!profiles.p1) profiles.p1 = emptyProfile();
        if (!profiles.p2) profiles.p2 = emptyProfile();
        each({ p1: 1, p2: 1 }, function (pid) {
            var p = profiles[pid];
            if (!p.manual) p.manual = {};
            if (!p.opened) p.opened = {};
        });
        impressions = storeGet(KEYS.impressions, {});
        meta = storeGet(KEYS.meta, {});
        state = storeGet(KEYS.state, {});
        if (!state.seen) state.seen = {};
        if (!state.hidden) state.hidden = {};
        if (!state.rel) state.rel = {};
    }

    function saveProfiles() { persist(KEYS.profiles, profiles); }
    function saveImpressions() { persist(KEYS.impressions, impressions); }
    function saveMeta() { persist(KEYS.meta, meta); }
    function saveState() { persist(KEYS.state, state); }

    // Обмеження розміру мап: лишаємо `max` найсвіжіших за полем часу
    function prune(map, max, timeOf) {
        var keys = [];
        each(map, function (k) { keys.push(k); });
        if (keys.length <= max) return false;
        keys.sort(function (a, b) { return timeOf(map[b]) - timeOf(map[a]); });
        for (var i = max; i < keys.length; i++) delete map[keys[i]];
        return true;
    }

    function activeProfile() {
        var a = '';
        try { a = Lampa.Storage.get(KEYS.active, 'p1'); } catch (e) { }
        return a === 'p2' || a === 'duo' ? a : 'p1';
    }

    function setActiveProfile(pid) {
        try { Lampa.Storage.set(KEYS.active, pid); } catch (e) { }
        invalidate();
        updateHeadLabel();
    }

    // Профілі, на які діють дії в поточному режимі
    function targetProfiles() {
        var a = activeProfile();
        return a === 'duo' ? ['p1', 'p2'] : [a];
    }

    // ------------------------------------------------------------------
    // Допоміжні функції для карток
    // ------------------------------------------------------------------
    function typeOf(card) {
        if (!card) return 'movie';
        if (card.media_type === 'tv' || card.media_type === 'movie') return card.media_type;
        if (card.original_name) return 'tv';
        if (card.number_of_seasons) return 'tv';
        if (card.first_air_date && !card.original_title) return 'tv';
        return 'movie';
    }

    function keyFor(type, id) { return (type === 'tv' ? 't' : 'm') + id; }
    function keyOf(card) { return keyFor(typeOf(card), card.id); }

    function dateOf(card) { return (card && (card.release_date || card.first_air_date)) || ''; }

    function decadeOf(card) {
        var y = parseInt(dateOf(card).slice(0, 4), 10);
        if (!y || y < 1900) return '';
        return (Math.floor(y / 10) * 10) + 's';
    }

    function titleOf(card) { return (card && (card.title || card.name || card.original_title || card.original_name)) || ''; }

    function genreIdsOf(card, m) {
        if (card && card.genre_ids && card.genre_ids.length) return card.genre_ids;
        if (card && card.genres && card.genres.length) {
            var out = [];
            for (var i = 0; i < card.genres.length; i++) if (card.genres[i] && card.genres[i].id) out.push(card.genres[i].id);
            return out;
        }
        return (m && m.g) || [];
    }

    // Серіальні жанри → кіно-еквіваленти; результат без дублів
    function canonGenres(ids) {
        var out = [];
        for (var i = 0; i < (ids || []).length; i++) {
            var g = parseInt(ids[i], 10);
            var mapped = TV_TO_CANON[g] || [g];
            for (var j = 0; j < mapped.length; j++) if (out.indexOf(mapped[j]) < 0) out.push(mapped[j]);
        }
        return out;
    }

    // Канонічні жанри → id для discover потрібного типу
    function genresForType(ids, type) {
        var out = [];
        for (var i = 0; i < ids.length; i++) {
            var g = ids[i];
            var v = type === 'tv' ? CANON_TO_TV[g] : (has(MOVIE_GENRES, g) ? g : null);
            if (v && out.indexOf(v) < 0) out.push(v);
        }
        return out;
    }

    function genreName(g) { return GENRE_UA[g] || ''; }

    function keywordName(name) {
        if (!name) return '';
        var ua = KEYWORD_UA[String(name).toLowerCase()];
        return ua || name;
    }

    // Чиста копія результату TMDB для рендеру картки (без спільних params)
    function cleanItem(c) {
        var o = {};
        each(c, function (k, v) { if (k !== 'params') o[k] = v; });
        o.source = 'tmdb';
        return o;
    }

    // ------------------------------------------------------------------
    // Прогрес перегляду з Lampa.Timeline
    // ------------------------------------------------------------------
    var watchedLast = null;

    function progressOf(card) {
        var res = { percent: 0, updated: 0 };
        try {
            var T = Lampa.Timeline, U = Lampa.Utils;
            if (!T || !U || !T.view) return res;
            if (typeOf(card) === 'movie') {
                var v = T.view(U.hash(card.original_title || card.title || ''), T.link ? T.link(card) : undefined);
                res.percent = v.percent || 0;
                res.updated = v.updated || 0;
                return res;
            }
            // Серіал: дивимось 1-й сезон + останню серію з історії онлайн-перегляду
            var list = T.watched ? (T.watched(card, true) || []) : [];
            var maxp = 0, done = 0, upd = 0;
            for (var i = 0; i < list.length; i++) {
                var p = (list[i].view && list[i].view.percent) || 0;
                if (p > maxp) maxp = p;
                if (p >= 75) done++;
                if (list[i].view && list[i].view.updated > upd) upd = list[i].view.updated;
            }
            if (watchedLast === null) watchedLast = storeGet('online_watched_last', {});
            var last = watchedLast[U.hash(card.original_name || card.original_title || '')];
            var deep = last && parseInt(last.season, 10) > 1;
            if (done >= 3 || deep) res.percent = 80;
            else if (list.length && maxp >= 20) res.percent = 40;
            else if (list.length) res.percent = Math.max(1, Math.min(maxp, 14));
            res.updated = upd;
            return res;
        } catch (e) {
            return res;
        }
    }

    function decay(t) {
        var age = now() - (t || 0);
        if (age <= 14 * DAY) return 1.5;
        if (age <= 60 * DAY) return 1.0;
        return 0.5;
    }

    // ------------------------------------------------------------------
    // Сигнали з Lampa.Favorite (синхронізуються через CUB)
    // ------------------------------------------------------------------
    function readFavorites() {
        var out = {};
        for (var i = 0; i < FAV_TYPES.length; i++) {
            var t = FAV_TYPES[i], arr = [];
            try { arr = (Lampa.Favorite && Lampa.Favorite.get) ? (Lampa.Favorite.get({ type: t }) || []) : []; } catch (e) { arr = []; }
            var clean = [];
            for (var j = 0; j < arr.length; j++) if (arr[j] && arr[j].id) clean.push(arr[j]);
            out[t] = clean;
        }
        return out;
    }

    // Приблизний час для першого запуску на новому пристрої (за позицією у списку)
    function bootTime(it, tnow) {
        var days;
        if (typeof it.pos.history === 'number') {
            var p = it.pos.history;
            days = p < 15 ? 3 : p < 60 ? 30 : 120;
        } else {
            var min = 9999;
            each(it.pos, function (k, v) { if (v < min) min = v; });
            days = min < 10 ? 10 : min < 40 ? 45 : 120;
        }
        return tnow - days * DAY;
    }

    function scanSignals() {
        var fav = readFavorites();
        var items = {}, order = [];
        var tnow = now();
        watchedLast = null;

        for (var i = 0; i < FAV_TYPES.length; i++) {
            var t = FAV_TYPES[i];
            for (var j = 0; j < fav[t].length; j++) {
                var card = fav[t][j];
                var key = keyOf(card);
                var it = items[key];
                if (!it) {
                    it = items[key] = { key: key, card: card, id: card.id, type: typeOf(card), lists: {}, pos: {} };
                    order.push(key);
                }
                it.lists[t] = true;
                if (typeof it.pos[t] !== 'number') it.pos[t] = j;
            }
        }

        var boot = !state.boot;
        var seenChanged = false;
        for (i = 0; i < order.length; i++) {
            var k = order[i];
            if (!state.seen[k]) {
                state.seen[k] = boot ? bootTime(items[k], tnow) : tnow;
                seenChanged = true;
            }
        }
        if (boot) { state.boot = tnow; seenChanged = true; }

        var list = [], scanned = 0;
        for (i = 0; i < order.length; i++) {
            var item = items[order[i]], l = item.lists;
            var p = { percent: 0, updated: 0 };
            if ((l.history || l.look || l.continued || l.book || l.wath || l.like) && scanned < 250) {
                p = progressOf(item.card);
                scanned++;
            }
            var stamp = p.updated || state.seen[item.key] || tnow;
            var w = 0;
            if (l.thrown) w = W.thrown;
            else if (l.like || l.viewed || p.percent >= 75) w = W.completed;
            else if (p.percent >= 20) w = W.progress;
            else if (p.percent > 0 && p.percent < 15 && tnow - stamp > 5 * DAY) w = W.abandoned;
            else if (l.look || l.continued) w = W.look;
            else if (l.book || l.wath || l.scheduled) w = W.book;
            else if (l.history) w = W.history;

            item.progress = p.percent;
            item.w = w;
            item.t = stamp;
            item.genres = canonGenres(genreIdsOf(item.card, meta[item.key]));
            item.decade = decadeOf(item.card);
            item.title = titleOf(item.card);
            list.push(item);
        }

        if (seenChanged) {
            prune(state.seen, 4000, function (v) { return v; });
            saveState();
        }

        return { items: items, list: list };
    }

    // ------------------------------------------------------------------
    // Вектор смаку профілю
    // ------------------------------------------------------------------
    function newVector() {
        return { genres: {}, keywords: {}, decades: {}, types: { movie: 0, tv: 0 }, seeds: {}, veto: {}, kwVeto: {} };
    }

    function addFeatures(v, f, s) {
        var i;
        for (i = 0; i < f.genres.length; i++) v.genres[f.genres[i]] = (v.genres[f.genres[i]] || 0) + s;
        var m = meta[f.key];
        if (m && m.k) {
            for (i = 0; i < m.k.length; i++) {
                var id = m.k[i][0];
                var e = v.keywords[id] || (v.keywords[id] = { name: m.k[i][1], score: 0, n: 0 });
                e.score += s;
                if (s > 0) e.n++;
            }
        }
        if (f.decade) v.decades[f.decade] = (v.decades[f.decade] || 0) + s;
        v.types[f.type] = (v.types[f.type] || 0) + s;
    }

    function addSeed(v, f, s) {
        var e = v.seeds[f.key];
        if (!e) e = v.seeds[f.key] = { key: f.key, id: f.id, type: f.type, title: f.title, genres: f.genres, decade: f.decade, t: f.t, w: 0, s: 0 };
        e.s += s;
        e.w = Math.max(e.w, f.w || 0);
        if (f.t > e.t) e.t = f.t;
    }

    function vectorFor(pid, sig) {
        var prof = profiles[pid];
        var other = profiles[pid === 'p1' ? 'p2' : 'p1'];
        var v = newVector();
        var i;

        for (i = 0; i < sig.list.length; i++) {
            var it = sig.list[i];
            if (!it.w) continue;
            // Атрибуція: тайтли, відкриті в цьому профілі, важать більше
            var factor = prof.opened[it.key] ? 1.0 : (other.opened[it.key] ? 0.25 : 0.6);
            var s = it.w * decay(it.t) * factor;
            addFeatures(v, it, s);
            addSeed(v, it, s);
        }

        each(prof.manual, function (key, m) {
            var f = { key: key, id: m.id, type: m.type, title: m.title, genres: m.g || [], decade: m.d || '', t: m.t, w: m.w };
            var s = m.w * decay(m.t);
            addFeatures(v, f, s);
            addSeed(v, f, s);
        });

        finalizeVector(v);
        return v;
    }

    function combineVal(a, b) {
        if (a <= VETO || b <= VETO) return { val: Math.min(a, b), veto: true };
        var s = a + b;
        if (a > 0 && b > 0) s *= DUO_BOOST;
        return { val: s, veto: false };
    }

    // Режим «Разом»: перетин підсилюється ×1.8, сильна антипатія будь-кого — вето
    function combineVectors(a, b) {
        var v = newVector();
        v.duo = true;
        var keys = {};
        each(a.genres, function (k) { keys[k] = 1; });
        each(b.genres, function (k) { keys[k] = 1; });
        each(keys, function (k) {
            var r = combineVal(a.genres[k] || 0, b.genres[k] || 0);
            v.genres[k] = r.val;
            if (r.veto) v.veto[k] = true;
        });

        keys = {};
        each(a.keywords, function (k) { keys[k] = 1; });
        each(b.keywords, function (k) { keys[k] = 1; });
        each(keys, function (k) {
            var ea = a.keywords[k], eb = b.keywords[k];
            var r = combineVal(ea ? ea.score : 0, eb ? eb.score : 0);
            v.keywords[k] = { name: (ea || eb).name, score: r.val, n: (ea ? ea.n : 0) + (eb ? eb.n : 0) };
            if (r.veto) v.kwVeto[k] = true;
        });

        keys = {};
        each(a.decades, function (k) { keys[k] = 1; });
        each(b.decades, function (k) { keys[k] = 1; });
        each(keys, function (k) { v.decades[k] = combineVal(a.decades[k] || 0, b.decades[k] || 0).val; });

        v.types.movie = (a.types.movie || 0) + (b.types.movie || 0);
        v.types.tv = (a.types.tv || 0) + (b.types.tv || 0);

        // Насіння: найкращі тайтли обох, без тих, що потрапили під вето
        each([a, b], function (idx, src) {
            each(src.seeds, function (key, e) {
                var vetoed = false;
                for (var i = 0; i < (e.genres || []).length; i++) if (v.veto[e.genres[i]]) vetoed = true;
                if (vetoed) return;
                var d = v.seeds[key];
                if (!d) {
                    d = v.seeds[key] = {};
                    each(e, function (kk, vv) { d[kk] = vv; });
                    d.s = 0;
                    d.hits = 0;
                }
                if (e.s > 0) d.hits++;
                d.s += e.s;
            });
        });
        // Тайтли, які подобаються обом, — першими
        each(v.seeds, function (key, d) { if (d.hits >= 2 && d.s > 0) d.s *= DUO_BOOST; });

        finalizeVector(v);
        return v;
    }

    function finalizeVector(v) {
        var gMax = 0, kMax = 0, dMax = 0;
        var pos = [], neg = [];
        each(v.genres, function (g, s) {
            if (s > gMax) gMax = s;
            if (s > 0) pos.push(parseInt(g, 10));
            if (s <= VETO || v.veto[g]) { neg.push(parseInt(g, 10)); v.veto[g] = true; }
        });
        each(v.keywords, function (k, e) {
            if (e.score > kMax) kMax = e.score;
            if (e.score <= VETO) v.kwVeto[k] = true;
        });
        each(v.decades, function (d, s) { if (s > dMax) dMax = s; });
        pos.sort(function (a, b) { return v.genres[b] - v.genres[a]; });
        v.gMax = gMax; v.kMax = kMax; v.dMax = dMax;
        v.topGenres = pos;
        v.negGenres = neg;
        v.empty = gMax <= 0;
    }

    function topKeywords(v, limit, minN) {
        var out = [];
        each(v.keywords, function (id, e) {
            if (e.score > 0 && e.n >= minN && !v.kwVeto[id] && !KEYWORD_STOP[String(e.name).toLowerCase()]) out.push({ id: id, name: e.name, score: e.score });
        });
        out.sort(function (a, b) { return b.score - a.score; });
        return out.slice(0, limit);
    }

    // Найсильніші тайтли типу; легкий шум між показами, щоб ряди не повторювались
    function topSeeds(v, type, count, pool) {
        var arr = [];
        each(v.seeds, function (k, e) { if (e.type === type && e.s > 0 && e.id) arr.push(e); });
        arr.sort(function (a, b) { return b.s - a.s; });
        var top = arr.slice(0, pool);
        for (var i = 0; i < top.length; i++) top[i]._j = top[i].s * (0.75 + Math.random() * 0.5);
        top.sort(function (a, b) { return b._j - a._j; });
        return top.slice(0, count);
    }

    // Зберігаємо «знімок» матриць смаку в профіль (прозорість + швидкий перегляд)
    function snapshot(pid, v) {
        var p = profiles[pid];
        var g = {}, k = {}, d = {};
        each(v.genres, function (id, s) { g[id] = Math.round(s * 10) / 10; });
        var kws = [];
        each(v.keywords, function (id, e) { kws.push({ id: id, e: e }); });
        kws.sort(function (a, b) { return Math.abs(b.e.score) - Math.abs(a.e.score); });
        for (var i = 0; i < Math.min(40, kws.length); i++) k[kws[i].id] = { name: kws[i].e.name, score: Math.round(kws[i].e.score * 10) / 10 };
        each(v.decades, function (id, s) { d[id] = Math.round(s * 10) / 10; });
        p.genres = g; p.keywords = k; p.decades = d; p.updated = now();
    }

    // ------------------------------------------------------------------
    // Контекст побудови (один на кожне відкриття головної)
    // ------------------------------------------------------------------
    var ctxCache = null;   // кеш смаку (сигнали + вектор), живе до 60 с або до змін
    var buildCtx = null;   // контекст одного проходу головної (спільний для рядів 0..8)

    function invalidate() {
        ctxCache = null;
        personalCache = {};
    }

    function getContext() {
        if (ctxCache && ctxCache.mode === activeProfile() && now() - ctxCache.created < 60000) return ctxCache;
        var sig = scanSignals();
        var mode = activeProfile();
        var v1 = vectorFor('p1', sig);
        var v2 = vectorFor('p2', sig);
        snapshot('p1', v1);
        snapshot('p2', v2);
        saveProfiles();
        var v = mode === 'duo' ? combineVectors(v1, v2) : (mode === 'p2' ? v2 : v1);

        ctxCache = {
            created: now(),
            mode: mode,
            sig: sig,
            vec: v,
            ex: excludedSet(sig)
        };
        return ctxCache;
    }

    // Lampa викликає фабрики всіх рядів синхронно в одному тіку →
    // усі ряди одного проходу ділять контекст, наступний прохід отримує новий
    function freshBuildContext() {
        if (buildCtx) return buildCtx;
        var taste = getContext();
        buildCtx = {
            mode: taste.mode,
            sig: taste.sig,
            vec: taste.vec,
            ex: excludedSet(taste.sig),
            used: {},
            gate: { started: [], done: {}, processed: {} }
        };
        var c = buildCtx;
        setTimeout(function () { buildCtx = null; }, 0);
        runProfiler(c);
        return c;
    }

    function excludedSet(sig) {
        var ex = {}, tnow = now();
        for (var i = 0; i < sig.list.length; i++) {
            var it = sig.list[i], l = it.lists;
            if (l.viewed || l.thrown || l.like || l.look || l.book || l.wath || l.scheduled || l.continued || it.progress >= 15 || it.w < 0) ex[it.key] = 1;
        }
        each(state.hidden, function (k) { ex[k] = 1; });
        each(impressions, function (k, e) { if (e.cool && e.cool > tnow) ex[k] = 1; });
        return ex;
    }

    // ------------------------------------------------------------------
    // Мережа TMDB (власний клієнт: без глобальних фільтрів і clear() Лампи)
    // ------------------------------------------------------------------
    var Net = (function () {
        var client = null, mem = {}, memCount = 0, wait = {};

        function req() {
            if (!client) {
                client = new Lampa.Reguest();
                if (client.timeout) client.timeout(12000);
            }
            return client;
        }

        function lang() {
            var l = '';
            try { l = Lampa.Storage.field('tmdb_lang'); } catch (e) { }
            if (!l) try { l = Lampa.Storage.get('language', 'uk'); } catch (e) { }
            return l || 'uk';
        }

        function key() {
            try { if (Lampa.TMDB && Lampa.TMDB.key) return Lampa.TMDB.key(); } catch (e) { }
            return '4ef0d7355d9ffb5151e987764708ce96';
        }

        function full(path) {
            var u = addParam(addParam(path, 'api_key=' + key()), 'language=' + lang());
            try { if (Lampa.TMDB && Lampa.TMDB.api) return Lampa.TMDB.api(u); } catch (e) { }
            return 'https://api.themoviedb.org/3/' + u;
        }

        function get(path, query, ok, fail, cacheMinutes) {
            var url = full(buildPath(path, query));
            if (mem[url]) {
                var data = mem[url];
                setTimeout(function () { ok(data); }, 0);
                return;
            }
            if (wait[url]) { wait[url].push([ok, fail]); return; }
            wait[url] = [[ok, fail]];

            var finish = function (json, err) {
                var list = wait[url] || [];
                delete wait[url];
                if (!err) {
                    if (memCount > 400) { mem = {}; memCount = 0; }
                    mem[url] = json; memCount++;
                }
                for (var i = 0; i < list.length; i++) {
                    try {
                        if (err) { if (list[i][1]) list[i][1](); }
                        else list[i][0](json);
                    } catch (e) { log('callback error', e); }
                }
            };

            try {
                req().silent(url, function (json) {
                    finish(json && typeof json === 'object' ? json : { results: [] }, false);
                }, function () {
                    finish(null, true);
                }, false, cacheMinutes ? { cache: { life: cacheMinutes } } : undefined);
            } catch (e) {
                finish(null, true);
            }
        }

        return { get: get, clearMem: function () { mem = {}; memCount = 0; } };
    })();

    function tmdbList(path, query, ok, cacheMinutes) {
        Net.get(path, query, function (json) {
            ok((json && json.results) || [], json || {});
        }, function () {
            ok([], {});
        }, cacheMinutes);
    }

    // ------------------------------------------------------------------
    // Мікро-теги: фонове профілювання ключових слів (з кешем)
    // ------------------------------------------------------------------
    var profilerRunning = false;

    function parseMeta(json, type) {
        var g = [], k = [], i;
        var gs = (json && json.genres) || [];
        for (i = 0; i < gs.length; i++) if (gs[i] && gs[i].id) g.push(gs[i].id);
        var kw = json && json.keywords ? (json.keywords.keywords || json.keywords.results || []) : [];
        for (i = 0; i < kw.length && k.length < 15; i++) {
            if (!kw[i] || !kw[i].id) continue;
            if (KEYWORD_STOP[String(kw[i].name || '').toLowerCase()]) continue;
            k.push([kw[i].id, kw[i].name]);
        }
        return { g: g, k: k, d: decadeOf(json), t: now() };
    }

    function needsMeta(key) {
        var m = meta[key];
        if (!m) return true;
        if (m.f && now() - m.t > 3 * DAY) return true;
        return false;
    }

    function fetchMeta(type, id, cb) {
        var key = keyFor(type, id);
        if (!needsMeta(key)) { if (cb) cb(meta[key]); return; }
        Net.get(type + '/' + id, { append_to_response: 'keywords' }, function (json) {
            if (json && json.id) {
                meta[key] = parseMeta(json, type);
            } else {
                meta[key] = { f: 1, t: now() };
            }
            prune(meta, 900, function (m) { return m.t || 0; });
            saveMeta();
            invalidateSoft();
            if (cb) cb(meta[key]);
        }, function () {
            meta[key] = { f: 1, t: now() };
            saveMeta();
            if (cb) cb(null);
        }, 60 * 24 * 7);
    }

    // Не скидаємо рядки, лише позначаємо, що наступна побудова має перерахувати смак
    function invalidateSoft() { if (ctxCache) ctxCache.created = 0; }

    var priorityQueue = [];

    function runProfiler(ctx) {
        if (profilerRunning) return;
        var queue = [];
        var i;
        for (i = 0; i < priorityQueue.length; i++) queue.push(priorityQueue[i]);
        priorityQueue = [];

        var cands = [];
        for (i = 0; i < ctx.sig.list.length; i++) {
            var it = ctx.sig.list[i];
            if (!it.w || !needsMeta(it.key)) continue;
            cands.push({ type: it.type, id: it.id, key: it.key, p: Math.abs(it.w) * decay(it.t) });
        }
        cands.sort(function (a, b) { return b.p - a.p; });
        for (i = 0; i < cands.length && i < PROFILER_BATCH; i++) queue.push(cands[i]);
        if (!queue.length) return;

        profilerRunning = true;
        var idx = 0;
        var next = function () {
            if (idx >= queue.length) { profilerRunning = false; return; }
            var q = queue[idx++];
            if (!needsMeta(keyFor(q.type, q.id))) return next();
            fetchMeta(q.type, q.id, function () { setTimeout(next, 350); });
        };
        setTimeout(next, 2500); // після того, як головна вже намалювалась
    }

    // ------------------------------------------------------------------
    // Скоринг кандидатів
    // ------------------------------------------------------------------
    function norm(x, max) { return max > 0 ? clamp(x / max, -1, 1) : 0; }

    function impressionPenalty(key) {
        var e = impressions[key];
        return e && e.c ? e.c * 1.5 : 0;
    }

    function genreMatch(c, v) {
        var gs = canonGenres(c.genre_ids || genreIdsOf(c));
        var aff = 0, veto = false;
        for (var i = 0; i < gs.length; i++) {
            var x = v.genres[gs[i]] || 0;
            if (v.veto[gs[i]]) veto = true;
            aff += norm(x, v.gMax);
        }
        return { score: gs.length ? 6 * aff / Math.sqrt(gs.length) : 0, veto: veto };
    }

    function scoreCandidate(c, type, v, extra) {
        extra = extra || {};
        var key = keyFor(type, c.id);
        var gm = genreMatch(c, v);
        var km = 0, i;
        var m = meta[key];
        if (m && m.k) {
            var ks = 0;
            for (i = 0; i < m.k.length; i++) {
                var e = v.keywords[m.k[i][0]];
                if (e) ks += norm(e.score, v.kMax);
                if (v.kwVeto[m.k[i][0]]) gm.veto = true;
            }
            km = clamp(3 * ks, -6, 6);
        }
        if (extra.kwHits) km += Math.min(6, 3 * extra.kwHits);
        var dm = 2 * norm(v.decades[decadeOf(c)] || 0, v.dMax);
        var s = (extra.overlap || 0) * 12 + (c.vote_average || 0) + gm.score + km + dm - impressionPenalty(key) + Math.random() * 1.5;
        if (gm.veto) s -= 25;
        if ((c.vote_count || 0) < 30) s -= 4;
        return s;
    }

    function bayes(c) {
        var vc = c.vote_count || 0, r = c.vote_average || 0, m = 150, C = 6.4;
        return (vc / (vc + m)) * r + (m / (vc + m)) * C;
    }

    // mode: 'rec' — рекомендації (вийшло ≥45 днів тому), 'digital' — уже в цифрі, 'any' — без перевірки дат
    function candidateOk(c, type, ex, mode, v) {
        if (!c || !c.id || c.adult || !c.poster_path) return false;
        if (ex && ex[keyFor(type, c.id)]) return false;
        var d = type === 'tv' ? c.first_air_date : c.release_date;
        if (mode !== 'any') {
            if (!d || d > today()) return false;
            if (type === 'movie' && mode === 'rec') {
                if (d > today(-45)) return false;
                if ((c.vote_count || 0) < 50 && d > today(-365)) return false;
            }
        }
        if (type === 'tv' && v) {
            var g = c.genre_ids || [];
            for (var i = 0; i < TV_ONLY_NOISE.length; i++) {
                if (has(g, TV_ONLY_NOISE[i]) && !((v.genres[TV_ONLY_NOISE[i]] || 0) > 0)) return false;
            }
        }
        return true;
    }

    // Фільтр «вже доступно в якості» для discover/movie
    function digitalQuery(q, strict) {
        if (strict) {
            q['with_release_type'] = '4|5|6';
            q['release_date.lte'] = today();
        } else {
            q['primary_release_date.lte'] = today(-45);
            if (!q['vote_count.gte'] || q['vote_count.gte'] < 50) q['vote_count.gte'] = 50;
        }
        return q;
    }

    function withoutGenres(v, type, keep) {
        var neg = genresForType(v.negGenres || [], type);
        if (keep) neg = neg.filter(function (g) { return keep.indexOf(g) < 0; });
        return neg.join(',');
    }

    // ------------------------------------------------------------------
    // Імпресії (анти-застій стрічки)
    // ------------------------------------------------------------------
    function recordImpressions(picks) {
        var tnow = now();
        for (var i = 0; i < picks.length && i < 10; i++) {
            var key = picks[i]._key;
            if (!key) continue;
            var e = impressions[key] || (impressions[key] = { c: 0, s: 0, t: 0 });
            if (e.s !== SESSION) {
                e.c++;
                e.s = SESSION;
                e.t = tnow;
                if (e.c >= IMPRESSION_LIMIT) {
                    e.cool = tnow + COOLDOWN_DAYS * DAY;
                    e.c = 0;
                }
            }
        }
        prune(impressions, 2500, function (e) { return Math.max(e.t || 0, e.cool || 0); });
        saveImpressions();
    }

    function clearImpression(key) {
        if (impressions[key]) {
            delete impressions[key];
            saveImpressions();
        }
    }

    // ------------------------------------------------------------------
    // Збирач кандидатів
    // ------------------------------------------------------------------
    function Pool(type, ctx, mode) {
        this.type = type;
        this.ctx = ctx;
        this.mode = mode;
        this.map = {};
    }

    Pool.prototype.add = function (results, opts, forcedType) {
        opts = opts || {};
        var type = forcedType || this.type;
        for (var i = 0; i < results.length; i++) {
            var c = results[i];
            var t = c.media_type === 'tv' || c.media_type === 'movie' ? c.media_type : type;
            if (t !== this.type) continue;
            if (!candidateOk(c, t, this.ctx.ex, opts.mode || this.mode, this.ctx.vec)) continue;
            var key = keyFor(t, c.id);
            var e = this.map[key] || (this.map[key] = { c: c, key: key, overlap: 0, kwHits: 0, seeds: {} });
            if (opts.seed && !e.seeds[opts.seed]) { e.seeds[opts.seed] = 1; e.overlap++; }
            if (opts.kw) e.kwHits = Math.max(e.kwHits, opts.kw);
            if (opts.bonus) e.bonus = (e.bonus || 0) + opts.bonus;
        }
    };

    // Вето: жанр або тег, який профіль (чи будь-хто в «Разом») сильно не любить
    function isVetoed(c, type, v) {
        var gs = canonGenres(c.genre_ids || genreIdsOf(c));
        for (var i = 0; i < gs.length; i++) if (v.veto[gs[i]]) return true;
        var m = meta[keyFor(type, c.id)];
        if (m && m.k) for (i = 0; i < m.k.length; i++) if (v.kwVeto[m.k[i][0]]) return true;
        return false;
    }

    Pool.prototype.scored = function (scoreFn) {
        var out = [], self = this;
        each(this.map, function (key, e) {
            if (isVetoed(e.c, self.type, self.ctx.vec)) return;
            var s = scoreFn ? scoreFn(e) : scoreCandidate(e.c, self.type, self.ctx.vec, e);
            out.push({ c: e.c, key: key, s: s + (e.bonus || 0) });
        });
        out.sort(function (a, b) { return b.s - a.s; });
        return out;
    };

    // ------------------------------------------------------------------
    // Черга видачі рядів: дедуплікація між рядами у порядку index
    // ------------------------------------------------------------------
    function gateStart(ctx, idx) {
        if (ctx.gate.started.indexOf(idx) < 0) ctx.gate.started.push(idx);
        ctx.gate.started.sort(function (a, b) { return a - b; });
    }

    function gateClaim(ctx, idx, list, finish) {
        if (ctx.gate.done[idx]) return;
        ctx.gate.done[idx] = { list: list || [], finish: finish };
        gateFlush(ctx);
    }

    function gateFlush(ctx) {
        var g = ctx.gate;
        for (var i = 0; i < g.started.length; i++) {
            var idx = g.started[i];
            if (g.processed[idx]) continue;
            var d = g.done[idx];
            if (!d) return;
            g.processed[idx] = true;
            var picks = [], rest = [];
            for (var j = 0; j < d.list.length; j++) {
                var e = d.list[j];
                if (ctx.used[e.key]) continue;
                if (picks.length < ROW_SIZE) { picks.push(e); ctx.used[e.key] = 1; }
                else if (rest.length < 60) rest.push(e);
            }
            try { d.finish(picks, rest); } catch (err) { log('finish error', err); }
        }
    }

    function toItems(entries) {
        var out = [];
        for (var i = 0; i < entries.length; i++) {
            var item = cleanItem(entries[i].c);
            item._key = entries[i].key;
            out.push(item);
        }
        return out;
    }

    var rowStore = {};

    function scoredRowJson(n, title, picks, rest) {
        var items = toItems(picks);
        recordImpressions(items);
        rowStore[n] = toItems(picks.concat(rest || []));
        return {
            title: title,
            results: items,
            source: 'smart_engine',
            url: 'smart:row:' + n,
            page: 1,
            total_pages: rowStore[n].length > items.length ? 2 : 1
        };
    }

    function discoverRowJson(title, path, query, items, totalPages) {
        var q = {};
        each(query, function (k, v) { if (k !== 'page') q[k] = v; });
        return {
            title: title,
            results: items,
            source: 'smart_engine',
            url: 'smart:raw:' + buildPath(path, q),
            page: 1,
            total_pages: Math.min(totalPages || 1, 30)
        };
    }

    function profileSuffix(ctx) {
        return ctx.mode === 'duo' ? ' · 👥 Разом' : ctx.mode === 'p2' ? ' · Профіль 2' : '';
    }

    // ------------------------------------------------------------------
    // Ряд 0: «Вже вийшло в якості» із закладок
    // ------------------------------------------------------------------
    function hasDigitalRelease(id, cb) {
        var cached = state.rel[id];
        if (cached && (cached.ok || now() - cached.t < 12 * 60 * 60 * 1000)) return cb(!!cached.ok);
        Net.get('movie/' + id + '/release_dates', {}, function (json) {
            var ok = false, tnow = now();
            var res = (json && json.results) || [];
            for (var i = 0; i < res.length && !ok; i++) {
                var rd = res[i].release_dates || [];
                for (var j = 0; j < rd.length; j++) {
                    var tp = rd[j].type, dt = Date.parse(rd[j].release_date || '');
                    if ((tp === 4 || tp === 5 || tp === 6) && dt && dt <= tnow) { ok = true; break; }
                }
            }
            state.rel[id] = { ok: ok, t: tnow };
            prune(state.rel, 300, function (r) { return r.t; });
            saveState();
            cb(ok);
        }, function () { cb(false); }, 60 * 12);
    }

    function buildRow0(ctx, done) {
        var list = [];
        var from = today(-180), to = today();
        for (var i = 0; i < ctx.sig.list.length; i++) {
            var it = ctx.sig.list[i], l = it.lists;
            if (it.type !== 'movie') continue;
            if (!(l.book || l.wath || l.like)) continue;
            if (l.viewed || l.thrown || state.hidden[it.key]) continue;
            if (it.progress >= 10) continue;
            var d = it.card.release_date || '';
            if (!d || d < from || d > to) continue;
            list.push(it);
        }
        if (!list.length) return done();

        list.sort(function (a, b) { return (b.card.release_date || '') > (a.card.release_date || '') ? 1 : -1; });
        var ok = [], checks = 0;
        var tasks = [];
        for (i = 0; i < list.length && i < 30; i++) {
            (function (it) {
                if ((it.card.release_date || '') <= today(-30)) { ok.push(it); return; }
                if (checks >= 8) return;
                checks++;
                tasks.push(function (cb) {
                    hasDigitalRelease(it.id, function (yes) { if (yes) ok.push(it); cb(); });
                });
            })(list[i]);
        }
        join(tasks, function () {
            if (!ok.length) return done();
            ok.sort(function (a, b) { return (b.card.release_date || '') > (a.card.release_date || '') ? 1 : -1; });
            var items = [];
            for (var j = 0; j < ok.length; j++) items.push(cleanItem(ok[j].card));
            done({ title: '🔥 Вже вийшло в якості (З ваших закладок)', results: items, source: 'tmdb', page: 1, total_pages: 1 });
        });
    }

    // ------------------------------------------------------------------
    // Ряди 1–2: персональний підбір (колаборативний перетин)
    // ------------------------------------------------------------------
    var personalCache = {};

    function personalCandidates(type, ctx, opts, done) {
        var v = ctx.vec;
        var seeds = topSeeds(v, type, opts.seeds || 4, opts.pool || 6);
        var pool = new Pool(type, ctx, 'rec');
        var tasks = [];

        if (seeds.length) {
            for (var i = 0; i < seeds.length; i++) {
                (function (seed) {
                    var pages = opts.pages || [rand(1, 2)];
                    for (var p = 0; p < pages.length; p++) {
                        (function (page) {
                            tasks.push(function (cb) {
                                tmdbList(type + '/' + seed.id + '/recommendations', { page: page }, function (res) {
                                    pool.add(res, { seed: seed.key });
                                    cb();
                                }, 60 * 24);
                            });
                        })(pages[p]);
                    }
                })(seeds[i]);
            }
        }

        // Ключові слова профілю → кандидати з keyword-збігом
        var kws = topKeywords(v, 6, 2);
        if (kws.length >= 2) {
            var pickedKw = shuffle(kws.slice(0)).slice(0, 3);
            var ids = [];
            for (var k = 0; k < pickedKw.length; k++) ids.push(pickedKw[k].id);
            tasks.push(function (cb) {
                var q = { with_keywords: ids.join('|'), without_genres: withoutGenres(v, type), sort_by: 'popularity.desc', 'vote_count.gte': type === 'tv' ? 60 : 100, page: rand(1, 2) };
                if (type === 'movie') digitalQuery(q, false);
                tmdbList('discover/' + type, q, function (res) { pool.add(res, { kw: 1 }); cb(); }, 60 * 6);
            });
        }

        // Серіали: discover/tv за улюбленими жанрами; також холодний старт
        var topG = genresForType(v.topGenres || [], type).slice(0, 3);
        if (type === 'tv' || !seeds.length) {
            tasks.push(function (cb) {
                var q = {
                    sort_by: 'popularity.desc',
                    'vote_count.gte': type === 'tv' ? 150 : 800,
                    'vote_average.gte': 6.8,
                    without_genres: withoutGenres(v, type),
                    with_genres: topG.length ? topG.join('|') : '',
                    page: rand(1, 3)
                };
                if (type === 'movie') digitalQuery(q, false);
                tmdbList('discover/' + type, q, function (res) { pool.add(res, {}); cb(); }, 60 * 6);
            });
        }

        join(tasks, function () { done(pool.scored()); });
    }

    function buildPersonalRow(n, type, ctx, finish) {
        personalCandidates(type, ctx, {}, function (list) {
            gateClaim(ctx, n, list, function (picks, rest) {
                if (!picks.length) return finish();
                var title = type === 'tv' ? '📺 Персональний підбір: Серіали' : '🎯 Персональний підбір: Фільми (Перетин смаків)';
                finish(scoredRowJson(n, title + profileSuffix(ctx), picks, rest));
            });
        });
    }

    // ------------------------------------------------------------------
    // Ряд 3: «Тому що ви дивилися …»
    // ------------------------------------------------------------------
    function pickRecentSeed(ctx) {
        var arr = [];
        each(ctx.vec.seeds, function (k, e) { if (e.s > 0 && e.id) arr.push(e); });
        arr.sort(function (a, b) { return b.t - a.t; });
        var strong = arr.filter(function (e) { return e.w >= W.progress; }).slice(0, 15);
        var src = strong.length ? strong : arr.slice(0, 15);
        return src.length ? src[rand(0, src.length - 1)] : null;
    }

    function buildBecauseRow(n, ctx, finish) {
        var seed = pickRecentSeed(ctx);
        if (!seed) return gateClaim(ctx, n, [], function () { finish(); });

        fetchMeta(seed.type, seed.id, function (m) {
            var type = seed.type;
            var v = ctx.vec;
            var pool = new Pool(type, ctx, 'rec');
            var tasks = [];
            var g = canonGenres((m && m.g && m.g.length) ? m.g : seed.genres || []);
            g.sort(function (a, b) { return (v.genres[b] || 0) - (v.genres[a] || 0); });
            var tg = genresForType(g, type).slice(0, 2);
            var kws = (m && m.k) ? m.k.slice(0) : [];
            kws.sort(function (a, b) {
                var ea = v.keywords[a[0]], eb = v.keywords[b[0]];
                return (eb ? eb.score : 0) - (ea ? ea.score : 0);
            });
            var kwIds = [];
            for (var i = 0; i < kws.length && kwIds.length < 2; i++) kwIds.push(kws[i][0]);

            tasks.push(function (cb) {
                tmdbList(type + '/' + seed.id + '/recommendations', { page: 1 }, function (res) { pool.add(res, { seed: seed.key }); cb(); }, 60 * 24);
            });
            if (tg.length || kwIds.length) {
                tasks.push(function (cb) {
                    var q = {
                        with_genres: tg.join(','),
                        with_keywords: kwIds.join('|'),
                        without_genres: withoutGenres(v, type, tg),
                        sort_by: 'popularity.desc',
                        'vote_count.gte': type === 'tv' ? 50 : 100,
                        page: rand(1, 2)
                    };
                    if (type === 'movie') digitalQuery(q, false);
                    tmdbList('discover/' + type, q, function (res) { pool.add(res, { kw: kwIds.length ? 1 : 0 }); cb(); }, 60 * 6);
                });
            }

            join(tasks, function () {
                var seedKey = seed.key;
                var list = pool.scored().filter(function (e) { return e.key !== seedKey; });
                gateClaim(ctx, n, list, function (picks, rest) {
                    if (!picks.length) return finish();
                    finish(scoredRowJson(n, '🎬 Тому що ви дивилися «' + seed.title + '»', picks, rest));
                });
            });
        });
    }

    // ------------------------------------------------------------------
    // Ряди 4–5: динамічні мікро-жанри
    // ------------------------------------------------------------------
    function microCombos(v, type, count) {
        var kws = topKeywords(v, 8, 2);
        if (kws.length < 2) kws = topKeywords(v, 8, 1);
        var out = [], used = {};
        var top = v.topGenres || [];
        for (var i = 0; i < top.length && out.length < (count || 4); i++) {
            var mapped = genresForType([top[i]], type)[0];
            if (!mapped || used[mapped]) continue;
            used[mapped] = 1;
            out.push({
                genre: mapped,
                canon: top[i],
                weight: v.genres[top[i]] || 0,
                kws: shuffle(kws.slice(0, 6)).slice(0, 2)
            });
        }
        return out;
    }

    function comboTitle(combo, type) {
        var t = '🧩 Підбірка за вашим смаком: ' + (genreName(combo.canon) || genreName(combo.genre));
        if (combo.kws && combo.kws.length) t += ' • ' + keywordName(combo.kws[0].name);
        return t + (type === 'tv' ? ' · Серіали' : ' · Фільми');
    }

    function comboQuery(combo, v, type, withKw) {
        var q = {
            with_genres: combo.genre,
            without_genres: withoutGenres(v, type, [combo.genre]),
            sort_by: 'popularity.desc',
            'vote_count.gte': type === 'tv' ? 80 : 150
        };
        if (withKw && combo.kws.length) {
            var ids = [];
            for (var i = 0; i < combo.kws.length; i++) ids.push(combo.kws[i].id);
            q.with_keywords = ids.join('|');
        }
        if (type === 'movie') digitalQuery(q, false);
        return q;
    }

    function buildMicroRow(n, type, ctx, finish) {
        var v = ctx.vec;
        var combos = microCombos(v, type, 3);
        if (!combos.length) return gateClaim(ctx, n, [], function () { finish(); });
        var combo = weightedPick(combos, function (c) { return c.weight; });
        var tries = 0;

        // Послаблення: спершу жанр+теги, далі лише жанр, далі інший жанр із топу
        var attempt = function (withKw) {
            tries++;
            var q = comboQuery(combo, v, type, withKw);
            q.page = rand(1, 2);
            tmdbList('discover/' + type, q, function (res, json) {
                var pool = new Pool(type, ctx, 'digital');
                pool.add(res, { kw: withKw ? 1 : 0 });
                var list = pool.scored();
                if (list.length < 8 && withKw) return attempt(false);
                if (list.length < 5 && tries < 4) {
                    var others = combos.filter(function (c) { return c !== combo; });
                    if (others.length) {
                        combos = others;
                        combo = others[0];
                        return attempt(combo.kws.length > 0);
                    }
                }
                if (!withKw) combo.kws = [];
                gateClaim(ctx, n, list, function (picks) {
                    if (!picks.length) return finish();
                    var items = toItems(picks);
                    recordImpressions(items);
                    finish(discoverRowJson(comboTitle(combo, type), 'discover/' + type, q, items, json.total_pages));
                });
            }, 60 * 6);
        };
        attempt(combo.kws.length > 0);
    }

    // ------------------------------------------------------------------
    // Ряд 6: свіжі цифрові релізи під профіль
    // ------------------------------------------------------------------
    function buildFreshRow(n, ctx, finish) {
        var v = ctx.vec;
        var topG = genresForType(v.topGenres || [], 'movie').slice(0, 3);
        var q = {
            'release_date.gte': today(-180),
            with_genres: topG.join('|'),
            without_genres: withoutGenres(v, 'movie', topG),
            sort_by: 'popularity.desc',
            'vote_count.gte': 20
        };
        digitalQuery(q, true);
        var pool = new Pool('movie', ctx, 'digital');
        var total = 1;
        join([
            function (cb) { var qq = {}; each(q, function (k, x) { qq[k] = x; }); qq.page = 1; tmdbList('discover/movie', qq, function (res, json) { total = json.total_pages || 1; pool.add(res, {}); cb(); }, 60 * 3); },
            function (cb) { var qq = {}; each(q, function (k, x) { qq[k] = x; }); qq.page = 2; tmdbList('discover/movie', qq, function (res) { pool.add(res, {}); cb(); }, 60 * 3); }
        ], function () {
            var list = pool.scored(function (e) {
                var gm = genreMatch(e.c, v);
                return bayes(e.c) * 2 + gm.score * 0.7 - impressionPenalty(e.key) - (gm.veto ? 25 : 0) + Math.random();
            });
            gateClaim(ctx, n, list, function (picks) {
                if (!picks.length) return finish();
                var items = toItems(picks);
                recordImpressions(items);
                finish(discoverRowJson('⚡ Свіжі цифрові релізи (Під ваш профіль)', 'discover/movie', q, items, total));
            });
        });
    }

    // ------------------------------------------------------------------
    // Ряд 7: «Нові горизонти» (дослідження, 10% bandit)
    // ------------------------------------------------------------------
    function buildExploreRow(n, ctx, finish) {
        var v = ctx.vec;
        var tTotal = Math.abs(v.types.movie || 0) + Math.abs(v.types.tv || 0);
        var tvShare = tTotal ? Math.max(0, v.types.tv || 0) / tTotal : 0.5;
        var type = Math.random() < clamp(tvShare, 0.25, 0.75) ? 'tv' : 'movie';
        var base = type === 'tv' ? [10759, 16, 35, 80, 99, 18, 10751, 9648, 10765, 10768, 37] : MOVIE_GENRES.filter(function (g) { return g !== 10770; });
        var top3 = genresForType((v.topGenres || []).slice(0, 3), type);
        var neg = genresForType(v.negGenres || [], type);
        var maxG = v.gMax || 1;

        // Суміжні: жанри, що вже траплялись у позитиві, але слабо досліджені
        var adjacent = [], unexplored = [];
        for (var i = 0; i < base.length; i++) {
            var g = base[i];
            if (has(top3, g) || has(neg, g)) continue;
            var canon = canonGenres([g]);
            var w = 0;
            for (var j = 0; j < canon.length; j++) w = Math.max(w, v.genres[canon[j]] || 0);
            if (w > 0 && w < 0.35 * maxG) adjacent.push(g);
            else if (w === 0) unexplored.push(g);
        }
        var pickFrom = (Math.random() < 0.1 || !adjacent.length) ? (unexplored.length ? unexplored : adjacent) : adjacent;
        if (!pickFrom.length) pickFrom = base.filter(function (g) { return !has(neg, g); });
        var genre = pickFrom[rand(0, pickFrom.length - 1)];

        var q = {
            with_genres: genre,
            without_genres: neg.filter(function (x) { return x !== genre; }).join(','),
            'vote_average.gte': 7.3,
            'vote_count.gte': 500,
            sort_by: 'vote_average.desc',
            page: rand(1, 3)
        };
        if (type === 'movie') q['primary_release_date.lte'] = today(-45);

        tmdbList('discover/' + type, q, function (res, json) {
            var pool = new Pool(type, ctx, 'digital');
            pool.add(res, {});
            var list = pool.scored(function (e) {
                var gm = genreMatch(e.c, v);
                // Віддаємо перевагу тому, що НЕ схоже на звичний шаблон
                return bayes(e.c) * 2 - Math.max(0, gm.score) * 0.4 - impressionPenalty(e.key) - (gm.veto ? 25 : 0) + Math.random() * 2;
            });
            gateClaim(ctx, n, list, function (picks) {
                if (!picks.length) return finish();
                var items = toItems(picks);
                recordImpressions(items);
                var title = '🎲 Нові горизонти (Високий рейтинг поза шаблоном)' + (type === 'tv' ? ' · Серіали' : ' · Фільми');
                finish(discoverRowJson(title, 'discover/' + type, q, items, json.total_pages));
            });
        }, 60 * 12);
    }

    // ------------------------------------------------------------------
    // Ряд 8: очікувані прем'єри та новинки кінопрокату
    // ------------------------------------------------------------------
    function upcomingQuery(v) {
        return {
            'primary_release_date.gte': today(1),
            'primary_release_date.lte': today(150),
            without_genres: withoutGenres(v, 'movie'),
            sort_by: 'popularity.desc'
        };
    }

    function theatricalQuery(v) {
        return {
            with_release_type: '2|3',
            'release_date.gte': today(-40),
            'release_date.lte': today(),
            without_genres: withoutGenres(v, 'movie'),
            sort_by: 'popularity.desc'
        };
    }

    function buildUpcomingRow(ctx, finish) {
        var v = ctx.vec;
        var hidden = {};
        each(state.hidden, function (k) { hidden[k] = 1; });
        var up = [], th = [], total = 1;
        var uq = upcomingQuery(v), tq = theatricalQuery(v);
        join([
            function (cb) { tmdbList('discover/movie', uq, function (res, json) { up = res; total = json.total_pages || 1; cb(); }, 60 * 6); },
            function (cb) { tmdbList('discover/movie', tq, function (res) { th = res; cb(); }, 60 * 6); }
        ], function () {
            var score = function (c) {
                var gm = genreMatch(c, v);
                return Math.log(1 + (c.popularity || 0)) + gm.score * 0.5 - (gm.veto ? 25 : 0);
            };
            var pick = function (arr) {
                return arr.filter(function (c) { return candidateOk(c, 'movie', hidden, 'any', v) && !isVetoed(c, 'movie', v); })
                    .sort(function (a, b) { return score(b) - score(a); });
            };
            var a = pick(up), b = pick(th), items = [], seen = {};
            while ((a.length || b.length) && items.length < ROW_SIZE) {
                var c = a.length ? a.shift() : null;
                if (c && !seen[c.id]) { seen[c.id] = 1; items.push(cleanItem(c)); }
                var d = b.length ? b.shift() : null;
                if (d && !seen[d.id] && items.length < ROW_SIZE) { seen[d.id] = 1; items.push(cleanItem(d)); }
            }
            if (!items.length) return finish();
            finish(discoverRowJson('🗓 Очікувані прем\'єри та новинки кінопрокату', 'discover/movie', uq, items, total));
        });
    }

    // ------------------------------------------------------------------
    // Реєстрація рядів на головній
    // ------------------------------------------------------------------
    var ROWS = [
        { index: 0, name: 'smart_engine_row0', title: '🔥 Вже вийшло в якості (Закладки)', gate: false, build: function (n, ctx, f) { buildRow0(ctx, f); } },
        { index: 1, name: 'smart_engine_row1', title: '🎯 Персональний підбір: Фільми', gate: true, build: function (n, ctx, f) { buildPersonalRow(n, 'movie', ctx, f); } },
        { index: 2, name: 'smart_engine_row2', title: '📺 Персональний підбір: Серіали', gate: true, build: function (n, ctx, f) { buildPersonalRow(n, 'tv', ctx, f); } },
        { index: 3, name: 'smart_engine_row3', title: '🎬 Тому що ви дивилися…', gate: true, build: buildBecauseRow },
        { index: 4, name: 'smart_engine_row4', title: '🧩 Мікро-жанр: Фільми', gate: true, build: function (n, ctx, f) { buildMicroRow(n, 'movie', ctx, f); } },
        { index: 5, name: 'smart_engine_row5', title: '🧩 Мікро-жанр: Серіали', gate: true, build: function (n, ctx, f) { buildMicroRow(n, 'tv', ctx, f); } },
        { index: 6, name: 'smart_engine_row6', title: '⚡ Свіжі цифрові релізи', gate: true, build: buildFreshRow },
        { index: 7, name: 'smart_engine_row7', title: '🎲 Нові горизонти', gate: true, build: buildExploreRow },
        { index: 8, name: 'smart_engine_row8', title: '🗓 Очікувані прем\'єри', gate: false, build: function (n, ctx, f) { buildUpcomingRow(ctx, f); } }
    ];

    function makeRowCallback(row) {
        return function (params, screen) {
            var ctx;
            try { ctx = freshBuildContext(); } catch (e) { log('context error', e); return; }
            return function (call) {
                var finish = once(function (json) {
                    try { call(json && json.results && json.results.length ? json : undefined); } catch (e) { log('row call error', e); }
                });
                if (row.gate) gateStart(ctx, row.index);
                var timer = setTimeout(function () {
                    if (row.gate) gateClaim(ctx, row.index, [], function () { });
                    finish();
                }, ROW_TIMEOUT);
                try {
                    row.build(row.index, ctx, function (json) { clearTimeout(timer); finish(json); });
                } catch (e) {
                    log('row build error', row.name, e);
                    clearTimeout(timer);
                    if (row.gate) gateClaim(ctx, row.index, [], function () { });
                    finish();
                }
            };
        };
    }

    function registerRows() {
        if (!Lampa.ContentRows || !Lampa.ContentRows.add) {
            log('ContentRows API недоступне — оновіть Lampa');
            return false;
        }
        for (var i = 0; i < ROWS.length; i++) {
            var row = ROWS[i];
            Lampa.ContentRows.add({
                index: row.index,
                name: row.name,
                title: row.title,
                screen: ['main'],
                call: makeRowCallback(row)
            });
        }
        return true;
    }

    // ------------------------------------------------------------------
    // Власне джерело для повноекранних каталогів (Навігатор, «Ще», «Схоже»)
    // ------------------------------------------------------------------
    function paged(items, page) {
        var per = 40;
        var total = Math.max(1, Math.ceil(items.length / per));
        return { results: items.slice((page - 1) * per, page * per), page: page, total_pages: total, total_results: items.length };
    }

    function moreLikeList(type, id, done) {
        var ctx = getContext();
        var key = keyFor(type, id);
        fetchMeta(type, id, function (m) {
            var pool = new Pool(type, ctx, 'rec');
            var tasks = [];
            var add = function (path, query, opts) {
                tasks.push(function (cb) { tmdbList(path, query, function (res) { pool.add(res, opts); cb(); }, 60 * 24); });
            };
            add(type + '/' + id + '/recommendations', { page: 1 }, { seed: key });
            add(type + '/' + id + '/recommendations', { page: 2 }, { seed: key });
            add(type + '/' + id + '/similar', { page: 1 }, { seed: key + 's' });
            var kw = (m && m.k) ? m.k.slice(0, 3) : [];
            if (kw.length) {
                var ids = [];
                for (var i = 0; i < kw.length; i++) ids.push(kw[i][0]);
                var tg = genresForType(canonGenres((m && m.g) || []), type).slice(0, 1);
                var q = { with_keywords: ids.join('|'), with_genres: tg.join(','), sort_by: 'popularity.desc', 'vote_count.gte': type === 'tv' ? 30 : 80 };
                if (type === 'movie') digitalQuery(q, false);
                add('discover/' + type, q, { kw: 2 });
            }
            join(tasks, function () {
                var list = pool.scored().filter(function (e) { return e.key !== key; });
                done(toItems(list.slice(0, 80)));
            });
        });
    }

    var SmartSource = {
        list: function (params, oncomplete, onerror) {
            var url = (params && params.url) || '';
            var page = parseInt((params && params.page) || 1, 10) || 1;
            var fail = function () { if (onerror) onerror(); };
            var ok = function (items, pg) {
                if (!items.length) return fail();
                oncomplete(paged(items, pg || page));
            };

            if (url.indexOf('smart:raw:') === 0) {
                var path = url.slice(10);
                var hidden = {};
                each(state.hidden, function (k) { hidden[k] = 1; });
                Net.get(path, { page: page }, function (json) {
                    var type = path.indexOf('/tv') >= 0 ? 'tv' : 'movie';
                    var res = ((json && json.results) || []).filter(function (c) { return candidateOk(c, type, hidden, 'any'); });
                    var out = [];
                    for (var i = 0; i < res.length; i++) out.push(cleanItem(res[i]));
                    if (!out.length && page === 1) return fail();
                    oncomplete({ results: out, page: page, total_pages: Math.min((json && json.total_pages) || 1, 100), total_results: (json && json.total_results) || out.length });
                }, fail, 60 * 3);
                return;
            }

            if (url.indexOf('smart:row:') === 0) {
                var n = url.slice(10);
                return ok(rowStore[n] || []);
            }

            if (url.indexOf('smart:personal:') === 0) {
                var type = url.slice(15) === 'tv' ? 'tv' : 'movie';
                var cacheKey = activeProfile() + type;
                if (personalCache[cacheKey]) return ok(personalCache[cacheKey]);
                personalCandidates(type, getContext(), { seeds: 6, pool: 8, pages: [1, 2] }, function (list) {
                    personalCache[cacheKey] = toItems(list.slice(0, 120));
                    ok(personalCache[cacheKey]);
                });
                return;
            }

            if (url.indexOf('smart:more:') === 0) {
                var parts = url.split(':');
                return moreLikeList(parts[2] === 'tv' ? 'tv' : 'movie', parseInt(parts[3], 10), function (items) { ok(items); });
            }

            fail();
        },
        clear: function () { }
    };

    function registerSource() {
        try {
            if (!Lampa.Api || !Lampa.Api.sources) return;
            var tmdb = Lampa.Api.sources.tmdb;
            var names = ['main', 'menu', 'category', 'full', 'person', 'seasons', 'company', 'search'];
            for (var i = 0; i < names.length; i++) {
                (function (name) {
                    SmartSource[name] = function () {
                        if (tmdb && typeof tmdb[name] === 'function') return tmdb[name].apply(tmdb, arguments);
                    };
                })(names[i]);
            }
            Lampa.Api.sources.smart_engine = SmartSource;
        } catch (e) { log('source register error', e); }
    }

    function openCatalog(title, url) {
        try {
            Lampa.Activity.push({ url: url, title: title, component: 'category_full', source: 'smart_engine', page: 1 });
        } catch (e) { log('open catalog error', e); }
    }

    // ------------------------------------------------------------------
    // Дії навчання (контекстне меню картки)
    // ------------------------------------------------------------------
    function manualSignal(card, w) {
        var type = typeOf(card);
        var key = keyFor(type, card.id);
        var g = canonGenres(genreIdsOf(card, meta[key]));
        var pids = targetProfiles();
        for (var i = 0; i < pids.length; i++) {
            var p = profiles[pids[i]];
            var prev = p.manual[key];
            p.manual[key] = {
                w: (prev ? prev.w : 0) + w,
                t: now(),
                id: card.id,
                type: type,
                title: titleOf(card),
                g: g,
                d: decadeOf(card)
            };
            p.manual[key].w = clamp(p.manual[key].w, -12, 18);
            prune(p.manual, 500, function (m) { return m.t || 0; });
        }
        saveProfiles();
        if (needsMeta(key)) fetchMeta(type, card.id);
        invalidate();
    }

    function favoriteMark(where, card) {
        try {
            if (!Lampa.Favorite) return;
            var st = Lampa.Favorite.check ? Lampa.Favorite.check(card) : {};
            if (st && st[where]) return;
            if (Lampa.Favorite.toggle) Lampa.Favorite.toggle(where, card);
            else Lampa.Favorite.add(where, card);
        } catch (e) { log('favorite error', e); }
    }

    function hideLocally(card, mark) {
        var key = keyOf(card);
        state.hidden[key] = { m: mark, t: now() };
        prune(state.hidden, 3000, function (h) { return h.t || 0; });
        saveState();
    }

    function sibling(el, dir) {
        var s = dir > 0 ? el.nextSibling : el.previousSibling;
        while (s) {
            if (s.nodeType === 1 && s.className && String(s.className).indexOf('selector') >= 0) return s;
            s = dir > 0 ? s.nextSibling : s.previousSibling;
        }
        return null;
    }

    function removeCardElement(cardInst) {
        try {
            var el = cardInst && cardInst.html;
            if (el && el.jquery) el = el[0];
            if (!el || !el.parentNode) return;
            var next = sibling(el, 1) || sibling(el, -1);
            var parent = el.parentNode;
            parent.removeChild(el);
            setTimeout(function () {
                try {
                    var en = Lampa.Controller.enabled();
                    if (en && en.name) Lampa.Controller.toggle(en.name);
                    if (next && next.parentNode) Lampa.Controller.collectionFocus(next, parent);
                } catch (e) { }
            }, 50);
        } catch (e) { log('remove card error', e); }
    }

    function notify(text) { try { Lampa.Noty.show(text); } catch (e) { } }

    function actionViewed(card, cardInst) {
        favoriteMark('viewed', card);
        hideLocally(card, 'viewed');
        manualSignal(card, W.act_viewed);
        removeCardElement(cardInst);
        notify('👁 Позначено як переглянуте — смак оновлено');
    }

    function actionHide(card, cardInst) {
        favoriteMark('thrown', card);
        hideLocally(card, 'thrown');
        manualSignal(card, W.act_hide);
        removeCardElement(cardInst);
        notify('🚫 Сховано. Схожого буде менше');
    }

    function actionMore(card) {
        manualSignal(card, W.act_more);
        var type = typeOf(card);
        openCatalog('🔍 Схоже на «' + titleOf(card) + '»', 'smart:more:' + type + ':' + card.id);
    }

    function menuItems(card, cardInst) {
        return [
            { title: '🧠 Розумні рекомендації', separator: true },
            { title: '👁 Вже бачив', subtitle: 'Сховати й врахувати в смаку', onSelect: function () { actionViewed(card, cardInst); } },
            { title: '🚫 Не цікавить / Сховати', subtitle: 'Менше схожого', onSelect: function () { actionHide(card, cardInst); } },
            { title: '🔍 Більше схожого на це', subtitle: 'Відкрити підбірку', onSelect: function () { actionMore(card); } }
        ];
    }

    function hookCardMenu() {
        // Нові модульні картки: модуль Menu спільний для всіх карток → додаємо onMenu
        try {
            var map = Lampa.Maker && Lampa.Maker.map ? Lampa.Maker.map('Card') : null;
            var Menu = map && map.Menu;
            if (Menu && typeof Menu === 'object') {
                if (Menu.onMenu && Menu.onMenu.__smart) return true;
                var prev = Menu.onMenu;
                var handler = function (menu, html, data) {
                    if (typeof prev === 'function') prev.apply(this, arguments);
                    try {
                        if (!menu || !data || !data.id) return;
                        var items = menuItems(data, this);
                        for (var i = 0; i < items.length; i++) menu.push(items[i]);
                    } catch (e) { log('menu inject error', e); }
                };
                handler.__smart = true;
                Menu.onMenu = handler;
                return true;
            }
        } catch (e) { log('menu hook error', e); }

        // Резерв для старих версій: пункт у розділі «Плагіни» контекстного меню
        try {
            Lampa.Manifest.plugins = {
                type: 'video',
                version: VERSION,
                name: '🧠 Розумні рекомендації',
                description: 'Вже бачив / Не цікавить / Більше схожого',
                onContextMenu: function () { return { name: '🧠 Розумні рекомендації', description: '' }; },
                onContextLauch: function (data) {
                    var items = menuItems(data, null).slice(1);
                    var enabled = Lampa.Controller.enabled().name;
                    Lampa.Select.show({
                        title: titleOf(data),
                        items: items,
                        onBack: function () { Lampa.Controller.toggle(enabled); }
                    });
                }
            };
        } catch (e) { log('manifest fallback error', e); }
        return false;
    }

    // ------------------------------------------------------------------
    // Неявні сигнали: відкриття картки, плеєр, таймлайн
    // ------------------------------------------------------------------
    function listenSignals() {
        try {
            Lampa.Listener.follow('full', function (e) {
                if (!e || e.type !== 'complite') return;
                var obj = e.object || {};
                var card = obj.card || (e.data && e.data.movie);
                if (!card || !card.id) return;
                var type = obj.method === 'tv' || obj.method === 'movie' ? obj.method : typeOf(card);
                var key = keyFor(type, card.id);

                var pids = targetProfiles();
                for (var i = 0; i < pids.length; i++) {
                    profiles[pids[i]].opened[key] = now();
                    prune(profiles[pids[i]].opened, 2000, function (t) { return t; });
                }
                saveProfiles();
                clearImpression(key);

                // Безкоштовні мікро-теги, якщо повна картка їх уже містить
                var movie = e.data && e.data.movie;
                if (movie && movie.keywords && needsMeta(key)) {
                    meta[key] = parseMeta(movie, type);
                    saveMeta();
                } else if (needsMeta(key)) {
                    priorityQueue.push({ type: type, id: card.id, key: key });
                    if (priorityQueue.length > 20) priorityQueue.shift();
                }
                invalidateSoft();
            });
        } catch (e) { log('full listener error', e); }

        try {
            if (Lampa.Player && Lampa.Player.listener) {
                Lampa.Player.listener.follow('destroy', function () { invalidateSoft(); });
            }
        } catch (e) { }

        try {
            if (Lampa.Timeline && Lampa.Timeline.listener) {
                Lampa.Timeline.listener.follow('update', function () { invalidateSoft(); });
            }
        } catch (e) { }

        try {
            Lampa.Listener.follow('state:changed', function (e) {
                if (e && e.target === 'favorite') invalidateSoft();
            });
        } catch (e) { }
    }

    // ------------------------------------------------------------------
    // Інтерфейс: перемикач профілю в шапці
    // ------------------------------------------------------------------
    var headButton = null;

    function updateHeadLabel() {
        if (!headButton) return;
        try { headButton.find('.smart-engine-head__text').text(HEAD_LABEL[activeProfile()]); } catch (e) { }
    }

    function refreshMain() {
        try {
            var act = Lampa.Activity.active();
            if (act && act.component === 'main') Lampa.Activity.replace();
        } catch (e) { log('refresh error', e); }
    }

    function openProfileSelect() {
        var current = activeProfile();
        var enabled = Lampa.Controller.enabled().name;
        var items = [];
        each(PROFILE_LABEL, function (pid, label) { items.push({ title: label, pid: pid, selected: pid === current }); });
        Lampa.Select.show({
            title: 'Профіль рекомендацій',
            items: items,
            onBack: function () { Lampa.Controller.toggle(enabled); },
            onSelect: function (a) {
                Lampa.Controller.toggle(enabled);
                if (a.pid === current) return;
                setActiveProfile(a.pid);
                notify('Активний профіль: ' + PROFILE_LABEL[a.pid]);
                refreshMain();
            }
        });
    }

    function injectHead() {
        try {
            headButton = $('<div class="head__action selector smart-engine-head"><span class="smart-engine-head__text"></span></div>');
            if (Lampa.Head && Lampa.Head.addElement) Lampa.Head.addElement(headButton, openProfileSelect);
            else {
                $('.head .head__actions').prepend(headButton);
                headButton.on('hover:enter', openProfileSelect);
            }
            updateHeadLabel();
        } catch (e) { log('head inject error', e); }
    }

    // ------------------------------------------------------------------
    // Інтерфейс: «Розумний навігатор & Анонси» у бічному меню
    // ------------------------------------------------------------------
    var MENU_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="2"/><path d="M15.8 8.2l-2.3 5.3-5.3 2.3 2.3-5.3 5.3-2.3z" fill="currentColor"/></svg>';

    function tasteSummary() {
        var ctx = getContext();
        var v = ctx.vec;
        var lines = [];
        var g = (v.topGenres || []).slice(0, 6).map(function (id) { return (genreName(id) || id) + ' (' + Math.round(v.genres[id]) + ')'; });
        lines.push({ title: 'Жанри', subtitle: g.length ? g.join(', ') : 'ще вчиться…', noenter: true });
        var neg = (v.negGenres || []).slice(0, 6).map(function (id) { return genreName(id) || id; });
        if (neg.length) lines.push({ title: 'Не подобається', subtitle: neg.join(', '), noenter: true });
        var k = topKeywords(v, 8, 1).map(function (e) { return keywordName(e.name); });
        lines.push({ title: 'Теги', subtitle: k.length ? k.join(', ') : 'збираються у фоні…', noenter: true });
        var d = [];
        each(v.decades, function (id, s) { if (s > 0) d.push({ id: id, s: s }); });
        d.sort(function (a, b) { return b.s - a.s; });
        lines.push({ title: 'Десятиліття', subtitle: d.length ? d.slice(0, 4).map(function (x) { return x.id; }).join(', ') : '—', noenter: true });
        return lines;
    }

    function microMenu(back) {
        var ctx = getContext();
        var items = [];
        each({ movie: 1, tv: 1 }, function (type) {
            var combos = microCombos(ctx.vec, type, 4);
            for (var i = 0; i < combos.length; i++) {
                (function (combo) {
                    var q = comboQuery(combo, ctx.vec, type, combo.kws.length > 0);
                    items.push({ title: comboTitle(combo, type).replace('🧩 Підбірка за вашим смаком: ', ''), url: 'smart:raw:' + buildPath('discover/' + type, q) });
                })(combos[i]);
            }
        });
        if (!items.length) {
            notify('Ще замало даних — подивіться кілька тайтлів');
            return back();
        }
        Lampa.Select.show({
            title: '🧩 Мої мікро-жанри',
            items: items,
            onBack: back,
            onSelect: function (a) { openCatalog(a.title, a.url); }
        });
    }

    function confirmReset(back) {
        var pids = targetProfiles();
        Lampa.Select.show({
            title: 'Скинути навчання: ' + PROFILE_LABEL[activeProfile()] + '?',
            items: [{ title: 'Так, скинути', yes: true }, { title: 'Скасувати' }],
            onBack: back,
            onSelect: function (a) {
                if (a.yes) {
                    for (var i = 0; i < pids.length; i++) profiles[pids[i]] = emptyProfile();
                    saveProfiles();
                    invalidate();
                    notify('Навчання профілю скинуто');
                    refreshMain();
                }
                back();
            }
        });
    }

    function openNavigator() {
        var enabled = Lampa.Controller.enabled().name;
        var back = function () { Lampa.Controller.toggle(enabled); };
        var v = { negGenres: [] };
        try { v = getContext().vec; } catch (e) { }

        var items = [
            { title: '🎯 Персональний підбір: Фільми', url: 'smart:personal:movie' },
            { title: '📺 Персональний підбір: Серіали', url: 'smart:personal:tv' },
            { title: '🗓 Очікувані фільми', url: 'smart:raw:' + buildPath('discover/movie', upcomingQuery(v)) },
            { title: '📡 Очікувані серіали', url: 'smart:raw:' + buildPath('discover/tv', { 'first_air_date.gte': today(1), 'first_air_date.lte': today(180), sort_by: 'popularity.desc', without_genres: withoutGenres(v, 'tv') }) },
            { title: '🎟 Новинки кінопрокату', url: 'smart:raw:' + buildPath('discover/movie', theatricalQuery(v)) },
            { title: '⚡ Свіжі цифрові релізи', url: 'smart:raw:' + buildPath('discover/movie', digitalQuery({ 'release_date.gte': today(-180), sort_by: 'popularity.desc', 'vote_count.gte': 20, without_genres: withoutGenres(v, 'movie') }, true)) },
            { title: '🧩 Мої мікро-жанри', action: 'micro' },
            { title: '📊 Мій смак', subtitle: PROFILE_LABEL[activeProfile()], action: 'taste' },
            { title: '👤 Змінити профіль', subtitle: PROFILE_LABEL[activeProfile()], action: 'profile' },
            { title: '♻️ Повернути приховані тайтли', action: 'unhide' },
            { title: '🧹 Скинути навчання профілю', action: 'reset' }
        ];

        Lampa.Select.show({
            title: 'Розумний навігатор & Анонси',
            items: items,
            onBack: back,
            onSelect: function (a) {
                if (a.url) return openCatalog(a.title, a.url);
                if (a.action === 'micro') return microMenu(back);
                if (a.action === 'profile') return openProfileSelect();
                if (a.action === 'taste') {
                    return Lampa.Select.show({ title: '📊 Мій смак · ' + PROFILE_LABEL[activeProfile()], items: tasteSummary(), onBack: back });
                }
                if (a.action === 'unhide') {
                    state.hidden = {};
                    saveState();
                    invalidate();
                    notify('Приховані тайтли знову можуть з\'являтися');
                    return back();
                }
                if (a.action === 'reset') return confirmReset(back);
                back();
            }
        });
    }

    function injectMenu() {
        try {
            if (Lampa.Menu && Lampa.Menu.addButton) {
                Lampa.Menu.addButton(MENU_ICON, 'Розумний навігатор & Анонси', openNavigator);
            } else {
                var li = $('<li class="menu__item selector"><div class="menu__ico">' + MENU_ICON + '</div><div class="menu__text">Розумний навігатор & Анонси</div></li>');
                li.on('hover:enter', openNavigator);
                $('.menu .menu__list').eq(0).append(li);
            }
        } catch (e) { log('menu inject error', e); }
    }

    function injectStyle() {
        try {
            var css = '' +
                '.head__action.smart-engine-head{width:auto;min-width:2.8em;border-radius:1.4em;padding:0 1em;white-space:nowrap;font-size:1em}' +
                '.smart-engine-head__text{display:block;line-height:1;font-weight:500}';
            var style = document.createElement('style');
            style.id = 'smart-engine-style';
            style.appendChild(document.createTextNode(css));
            document.head.appendChild(style);
        } catch (e) { }
    }

    // ------------------------------------------------------------------
    // Старт
    // ------------------------------------------------------------------
    var uiStarted = false;

    function startUI() {
        if (uiStarted) return;
        uiStarted = true;
        injectStyle();
        injectHead();
        injectMenu();
        listenSignals();
    }

    function init() {
        if (typeof Lampa === 'undefined') return;
        loadStore();
        registerSource();
        var rowsOk = registerRows();
        hookCardMenu();

        if (window.appready) {
            startUI();
            // Головна могла побудуватися до завантаження плагіна — один раз перебудуємо
            if (rowsOk) setTimeout(refreshMain, 300);
        } else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') startUI();
            });
        }
        log('v' + VERSION + ' ready, profile:', activeProfile());
    }

    // Публічний інтерфейс (для налагодження з консолі)
    window.SmartNetflixEngine = {
        version: VERSION,
        profile: activeProfile,
        setProfile: function (pid) { setActiveProfile(pid); refreshMain(); },
        taste: function () { return getContext().vec; },
        _internal: {
            scanSignals: scanSignals, vectorFor: vectorFor, combineVectors: combineVectors,
            scoreCandidate: scoreCandidate, recordImpressions: recordImpressions, getContext: getContext,
            impressions: function () { return impressions; }, profiles: function () { return profiles; },
            meta: function () { return meta; }, state: function () { return state; },
            invalidate: invalidate, menuItems: menuItems, SmartSource: SmartSource, ROWS: ROWS
        }
    };

    init();
})();
