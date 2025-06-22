const { addonBuilder } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const axios = require('axios');
const extractor = require('../unified-extractor');

// Initialize addon builder
const builder = new addonBuilder({
    id: 'org.bytetan.bytewatch',
    version: '1.0.1',
    name: 'ByteWatch',
    description: 'Get stream links for tv shows and movies from multiple sources',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    logo: 'https://www.bytetan.com/static/img/logo.png',
    idPrefixes: ['tt']
});

// Setup cache
const streamCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });

// Logger for Vercel
const logger = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`)
};

// Fetch OMDB details
async function fetchOmdbDetails(imdbId) {
    try {
        const response = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=b1e4f11`);
        if (response.data.Response === 'False') {
            throw new Error(response.data.Error || 'Failed to fetch data from OMDB API');
        }
        return response.data;
    } catch (e) {
        logger.error(`Error fetching metadata: ${e.message}`);
        return null;
    }
}

// Fetch TMDB ID
async function fetchTmdbId(imdbId) {
    try {
        const response = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id`, {
            headers: {
                accept: 'application/json',
                Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI3M2EyNzkwNWM1Y2IzNjE1NDUyOWNhN2EyODEyMzc0NCIsIm5iZiI6MS43MjM1ODA5NTAwMDg5OTk4ZSs5LCJzdWIiOiI2NmJiYzIxNjI2NmJhZmVmMTQ4YzVkYzkiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.y7N6qt4Lja5M6wnFkqqo44mzEMJ60Pzvm0z_TfA1vxk'
            }
        });
        return response.data;
    } catch (e) {
        logger.error(`Error fetching TMDB data: ${e.message}`);
        return null;
    }
}

// Extract all streams
async function extractAllStreams({ type, imdbId, season, episode }) {
    const streams = {};
    const tmdbRes = await fetchTmdbId(imdbId);

    if (!tmdbRes) {
        logger.warn('❌ Failed to fetch TMDB data');
        return streams;
    }

    const id = type === 'movie'
        ? tmdbRes['movie_results'][0]?.id
        : tmdbRes['tv_results'][0]?.id;

    if (!id) {
        logger.warn('❌ TMDB ID not found');
        return streams;
    }

    const [
        broflixResult,
        fmoviesResult,
        vidoraResult,
        videasyResult,
        viloraResult,
        vidsrcResult,
        vidfastResult
    ] = await Promise.allSettled([
        extractor('broflix', type, id, season, episode),
        extractor('fmovies', type, id, season, episode),
        extractor('vidora', type, id, season, episode),
        extractor('videasy', type, id, season, episode),
        extractor('vilora', type, id, season, episode),
        extractor('vidsrc', type, id, season, episode),
        extractor('vidfast', type, imdbId, season, episode) // vidfast uses IMDB ID
    ]);

    // Process results
    const results = [
        { name: 'fmovies', result: fmoviesResult },
        { name: 'broflix', result: broflixResult },
        { name: 'vidora', result: vidoraResult },
        { name: 'videasy', result: videasyResult },
        { name: 'vilora', result: viloraResult },
        { name: 'vidsrc', result: vidsrcResult },
        { name: 'vidfast', result: vidfastResult }
    ];

    results.forEach(({ name, result }) => {
        if (result.status === 'fulfilled' && result.value) {
            Object.assign(streams, result.value);
        } else {
            logger.warn(`❌ ${name} extraction failed: ${result.reason?.message}`);
        }
    });

    return streams;
}

// Get movie streams
async function getMovieStreams(imdbId) {
    const cacheKey = `movie:${imdbId}`;
    const metadata = await fetchOmdbDetails(imdbId);

    const cached = streamCache.get(cacheKey);
    if (cached) {
        logger.info(`Using cached stream for movie ${imdbId}`);
        return Object.entries(cached).map(([name, url]) => ({
            name,
            url,
            description: `${metadata?.Title || 'Movie'} (${metadata?.Year || 'Unknown'})`
        }));
    }

    const streams = await extractAllStreams({ type: 'movie', imdbId });
    streamCache.set(cacheKey, streams);

    return Object.entries(streams).map(([name, url]) => ({
        name,
        url,
        description: `${metadata?.Title || 'Movie'} (${metadata?.Year || 'Unknown'})`
    }));
}

// Get series streams
async function getSeriesStreams(imdbId, season, episode) {
    const cacheKey = `series:${imdbId}:${season}:${episode}`;
    const metadata = await fetchOmdbDetails(imdbId);

    const cached = streamCache.get(cacheKey);
    if (cached) {
        logger.info(`Using cached stream for series ${imdbId} S${season}E${episode}`);
        return Object.entries(cached).map(([name, url]) => ({
            name,
            url,
            description: `${metadata?.Title || 'Series'} S${season}E${episode}`
        }));
    }

    const streams = await extractAllStreams({ type: 'series', imdbId, season, episode });
    
    return Object.entries(streams).map(([name, url]) => ({
        name,
        url,
        description: `${metadata?.Title || 'Series'} S${season}E${episode}`
    }));
}

// Define stream handler
builder.defineStreamHandler(async ({ type, id }) => {
    logger.info(`Stream request: ${type}, ${id}`);
    try {
        if (type === 'movie') {
            const imdbId = id.split(':')[0];
            const streams = await getMovieStreams(imdbId);
            return { streams };
        }
        if (type === 'series') {
            const [imdbId, season, episode] = id.split(':');
            const streams = await getSeriesStreams(imdbId, season, episode);
            return { streams };
        }

        return { streams: [] };
    } catch (error) {
        logger.error(`Error in stream handler: ${error.message}`);
        return { streams: [] };
    }
});

// Vercel serverless function handler
module.exports = async (req, res) => {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    try {
        const path = req.url;
        
        if (path === '/manifest.json') {
            const manifest = builder.getInterface().manifest;
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json(manifest);
            return;
        }
        
        if (path.startsWith('/stream/')) {
            const pathParts = path.split('/');
            const type = pathParts[2];
            const id = pathParts[3];
            
            if (!type || !id) {
                res.status(400).json({ error: 'Missing type or id parameter' });
                return;
            }
            
            const result = await builder.getInterface().get('stream', type, id);
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json(result);
            return;
        }
        
        res.status(404).json({ error: 'Not found' });
    } catch (error) {
        logger.error(`API Error: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
};
