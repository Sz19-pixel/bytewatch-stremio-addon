const { addonBuilder } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const axios = require('axios');
const logger = require('./logger');
const extractor = require('./unified-extractor');

const streamCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });

const manifest = {
    id: 'org.bytetan.bytewatch',
    version: '1.0.1', // Increment version
    name: 'ByteWatch',
    description: 'Get stream links for tv shows and movies',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    logo: 'https://www.bytetan.com/static/img/logo.png',
    idPrefixes: ['tt'],
    // Add behavioral hints for better Stremio app compatibility
    behaviorHints: {
        adult: false,
        p2p: false,
        configurable: false,
        configurationRequired: false
    }
};

async function fetchOmdbDetails(imdbId) {
    try {
        // Use environment variable for API key
        const apiKey = process.env.OMDB_API_KEY || 'b1e4f11';
        const response = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}`, {
            timeout: 5000
        });
        if (response.data.Response === 'False') {
            logger.error('OMDB error: ' + JSON.stringify(response.data));
            return null;
        }
        return response.data;
    } catch (e) {
        logger.error('Error fetching OMDB metadata: ' + (e?.toString?.() ?? e));
        return null;
    }
}

async function fetchTmdbId(imdbId) {
    try {
        // Use environment variable for API key
        const bearerToken = process.env.TMDB_BEARER_TOKEN || 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI3M2EyNzkwNWM1Y2IzNjE1NDUyOWNhN2EyODEyMzc0NCIsIm5iZiI6MS43MjM1ODA5NTAwMDg5OTk4ZSs5LCJzdWIiOiI2NmJiYzIxNjI2NmJhZmVmMTQ4YzVkYzkiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.y7N6qt4Lja5M6wnFkqqo44mzEMJ60Pzvm0z_TfA1vxk';
        
        const response = await axios.get(
            `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id`,
            {
                timeout: 5000,
                headers: {
                    accept: 'application/json',
                    Authorization: `Bearer ${bearerToken}`,
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

    logger.info(`Extracting streams for ${type} ID: ${id}`);

    // Run extractors with better error handling
    const extractorPromises = [
        { name: 'broflix', promise: extractor('broflix', type, id, season, episode) },
        { name: 'fmovies', promise: extractor('fmovies', type, id, season, episode) },
        { name: 'vidora', promise: extractor('vidora', type, id, season, episode) },
        { name: 'videasy', promise: extractor('videasy', type, id, season, episode) },
        { name: 'vilora', promise: extractor('vilora', type, id, season, episode) },
        { name: 'vidsrc', promise: extractor('vidsrc', type, id, season, episode) },
        { name: 'vidfast', promise: extractor('vidfast', type, id, season, episode) },
    ];

    const results = await Promise.allSettled(extractorPromises.map(e => e.promise));

    results.forEach((result, index) => {
        const extractorName = extractorPromises[index].name;
        if (result.status === 'fulfilled' && result.value) {
            logger.info(`✅ ${extractorName} extraction successful`);
            for (const label in result.value) {
                streams[label] = result.value[label];
            }
        } else {
            logger.warn(`❌ ${extractorName} extraction failed: ${result.reason || 'Unknown error'}`);
        }
    });

    logger.info(`Total streams found: ${Object.keys(streams).length}`);
    return streams;
}

async function getMovieStreams(imdbId) {
    const cacheKey = `movie:${imdbId}`;
    const metadata = await fetchOmdbDetails(imdbId);

    const cached = streamCache.get(cacheKey);
    if (cached) {
        logger.info(`Cache hit for movie: ${imdbId}`);
        return Object.entries(cached).map(([name, url]) => ({
            name,
            url,
            description: `${metadata ? metadata.Title : imdbId} (${metadata ? metadata.Year : ''})`,
        }));
    }

    logger.info(`Fetching streams for movie: ${imdbId}`);
    const streams = await extractAllStreams({ type: 'movie', imdbId });
    
    if (Object.keys(streams).length > 0) {
        streamCache.set(cacheKey, streams);
    }

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
        logger.info(`Cache hit for series: ${imdbId} S${season}E${episode}`);
        return Object.entries(cached).map(([name, url]) => ({
            name,
            url,
            description: `${metadata ? metadata.Title : imdbId} S${season}E${episode}`,
        }));
    }

    logger.info(`Fetching streams for series: ${imdbId} S${season}E${episode}`);
    const streams = await extractAllStreams({ type: 'series', imdbId, season, episode });
    
    if (Object.keys(streams).length > 0) {
        streamCache.set(cacheKey, streams);
    }

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
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // Healthcheck or root
        if (req.url === '/' || req.url === '/health') {
            res.setHeader('Content-Type', 'application/json');
            res.status(200).end(JSON.stringify({ 
                status: 'ok', 
                timestamp: new Date().toISOString(),
                version: manifest.version
            }));
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
            
            logger.info(`Stream request: ${type} - ${id}`);
            
            if (type === 'movie') {
                const imdbId = id.split(':')[0];
                if (!imdbId.startsWith('tt')) {
                    throw new Error('Invalid IMDB ID format');
                }
                const streams = await getMovieStreams(imdbId);
                res.setHeader('Content-Type', 'application/json');
                res.status(200).end(JSON.stringify({ streams }));
                return;
            }
            
            if (type === 'series') {
                const [imdbId, season, episode] = id.split(':');
                if (!imdbId.startsWith('tt') || !season || !episode) {
                    throw new Error('Invalid series parameters');
                }
                const streams = await getSeriesStreams(imdbId, season, episode);
                res.setHeader('Content-Type', 'application/json');
                res.status(200).end(JSON.stringify({ streams }));
                return;
            }
        }

        // Fallback: 404
        res.status(404).end('Not Found');
        
    } catch (e) {
        logger.error('Handler error: ' + (e?.toString?.() ?? e));
        res.setHeader('Content-Type', 'application/json');
        res.status(500).end(JSON.stringify({ 
            streams: [], 
            error: 'Internal server error',
            timestamp: new Date().toISOString()
        }));
    }
};
