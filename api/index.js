const { addonBuilder } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const axios = require('axios');
const logger = require('./logger');
const extractor = require('./unified-extractor');

const streamCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });

const manifest = {
    id: 'org.bytetan.bytewatch',
    version: '1.0.0',
    name: 'ByteWatch',
    description: 'Get stream links for tv shows and movies',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    logo: 'https://www.bytetan.com/static/img/logo.png',
    idPrefixes: ['tt']
};

async function fetchOmdbDetails(imdbId) {
    try {
        const response = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=b1e4f11`);
        if (response.data.Response === 'False') {
            logger.error('OMDB error: ' + JSON.stringify(response.data));
            return null;
        }
        return response.data;
    } catch (e) {
        logger.error('Error fetching metadata: ' + (e?.toString?.() ?? e));
        return null;
    }
}

async function fetchTmdbId(imdbId) {
    try {
        const response = await axios.get(
            `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id`,
            {
                method: 'GET',
                headers: {
                    accept: 'application/json',
                    Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI3M2EyNzkwNWM1Y2IzNjE1NDUyOWNhN2EyODEyMzc0NCIsIm5iZiI6MS43MjM1ODA5NTAwMDg5OTk4ZSs5LCJzdWIiOiI2NmJiYzIxNjI2NmJhZmVmMTQ4YzVkYzkiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.y7N6qt4Lja5M6wnFkqqo44mzEMJ60Pzvm0z_TfA1vxk',
                },
            }
        );
        return response.data;
    } catch (e) {
        logger.error(
            'Error fetching TMDB ID: ' +
                (e?.response?.data ? JSON.stringify(e.response.data) : e.toString())
        );
        return null;
    }
}

async function extractAllStreams({ type, imdbId, season, episode }) {
    const streams = {};
    const tmdbRes = await fetchTmdbId(imdbId);

    if (!tmdbRes) {
        logger.warn('❌ TMDB API error or no response');
        return streams;
    }

    let id = null;
    if (type === 'movie') {
        if (Array.isArray(tmdbRes['movie_results']) && tmdbRes['movie_results'][0]) {
            id = tmdbRes['movie_results'][0].id;
        }
    } else if (type === 'series') {
        if (Array.isArray(tmdbRes['tv_results']) && tmdbRes['tv_results'][0]) {
            id = tmdbRes['tv_results'][0].id;
        }
    }

    if (!id) {
        logger.warn('❌ TMDB ID not found (no movie_results or tv_results)');
        return streams;
    }

    const results = await Promise.allSettled([
        extractor('broflix', type, id, season, episode),
        extractor('fmovies', type, id, season, episode),
        extractor('vidora', type, id, season, episode),
        extractor('videasy', type, id, season, episode),
        extractor('vilora', type, id, season, episode),
        extractor('vidsrc', type, id, season, episode),
        extractor('vidfast', type, id, season, episode),
    ]);

    for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
            for (const label in result.value) {
                streams[label] = result.value[label];
            }
        }
    }

    return streams;
}

async function getMovieStreams(imdbId) {
    const cacheKey = `movie:${imdbId}`;
    const metadata = await fetchOmdbDetails(imdbId);

    const cached = streamCache.get(cacheKey);
    if (cached) {
        return Object.entries(cached).map(([name, url]) => ({
            name,
            url,
            description: `${metadata ? metadata.Title : imdbId} (${metadata ? metadata.Year : ''})`,
        }));
    }
    const streams = await extractAllStreams({ type: 'movie', imdbId });
    streamCache.set(cacheKey, streams);

    return Object.entries(streams).map(([name, url]) => ({
        name,
        url,
        description: `${metadata ? metadata.Title : imdbId} (${metadata ? metadata.Year : ''})`,
    }));
}

async function getSeriesStreams(imdbId, season, episode) {
    const cacheKey = `series:${imdbId}:${season}:${episode}`;
    const metadata = await fetchOmdbDetails(imdbId);

    const cached = streamCache.get(cacheKey);
    if (cached) {
        return Object.entries(cached).map(([name, url]) => ({
            name,
            url,
            description: `${metadata ? metadata.Title : imdbId} S${season}E${episode}`,
        }));
    }

    const streams = await extractAllStreams({ type: 'series', imdbId, season, episode });
    streamCache.set(cacheKey, streams);

    return Object.entries(streams).map(([name, url]) => ({
        name,
        url,
        description: `${metadata ? metadata.Title : imdbId} S${season}E${episode}`,
    }));
}

// Vercel handler with CORS, health check, and robust error handling
module.exports = async (req, res) => {
    // Always set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

    // Healthcheck or root
    if (req.url === '/' || req.url === '/health') {
        res.setHeader('Content-Type', 'application/json');
        res.status(200).end(JSON.stringify({ status: 'ok' }));
        return;
    }

    if (req.url === '/manifest.json') {
        res.setHeader('Content-Type', 'application/json');
        res.status(200).end(JSON.stringify(manifest));
        return;
    }

    // /stream/movie/tt1234567 or /stream/series/tt1234567:1:2
    const streamMatch = req.url.match(/^\/stream\/(movie|series)\/(.+)/);
    if (streamMatch) {
        const type = streamMatch[1];
        const id = streamMatch[2];
        try {
            if (type === 'movie') {
                const imdbId = id.split(':')[0];
                const streams = await getMovieStreams(imdbId);
                res.setHeader('Content-Type', 'application/json');
                res.status(200).end(JSON.stringify({ streams }));
                return;
            }
            if (type === 'series') {
                const [imdbId, season, episode] = id.split(':');
                const streams = await getSeriesStreams(imdbId, season, episode);
                res.setHeader('Content-Type', 'application/json');
                res.status(200).end(JSON.stringify({ streams }));
                return;
            }
        } catch (e) {
            logger.error('Stream handler error: ' + (e?.toString?.() ?? e));
            res.setHeader('Content-Type', 'application/json');
            res.status(200).end(JSON.stringify({ streams: [] }));
            return;
        }
    }

    // Fallback: 404
    res.status(404).end('Not Found');
};
