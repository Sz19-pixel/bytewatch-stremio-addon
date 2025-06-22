const { addonBuilder } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const axios = require('axios');
const logger = require('../logger');
const extractor = require('../unified-extractor');

const streamCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });

const builder = new addonBuilder({
    id: 'org.bytetan.bytewatch',
    version: '1.0.0',
    name: 'ByteWatch',
    description: 'Get stream links for tv shows and movies',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    logo: 'https://www.bytetan.com/static/img/logo.png',
    idPrefixes: ['tt']
});

// Fetch movie data
async function fetchOmdbDetails(imdbId){
  try {
    const response = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=b1e4f11`);
     if (response.data.Response === 'False') {
      throw new Error(response.data || 'Failed to fetch data from OMDB API');
     }
    return response.data;
  } catch (e) {
    console.log(`Error fetching metadata: ${e}`)
    return null
  }
}

// Fetch TMDB ID
async function fetchTmdbId(imdbId){
  try {
      const response = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id`,
          {
              method: 'GET',
              headers: {
                  accept: 'application/json',
                  Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI3M2EyNzkwNWM1Y2IzNjE1NDUyOWNhN2EyODEyMzc0NCIsIm5iZiI6MS43MjM1ODA5NTAwMDg5OTk4ZSs5LCJzdWIiOiI2NmJiYzIxNjI2NmJhZmVmMTQ4YzVkYzkiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.y7N6qt4Lja5M6wnFkqqo44mzEMJ60Pzvm0z_TfA1vxk'
              }
          });
      return response.data;
  } catch (e) {
      console.log(`Error fetching metadata: ${e}`)
      return null
  }
}

async function extractAllStreams({type, imdbId, season, episode}) {
    const streams = {};
    const tmdbRes = await fetchTmdbId(imdbId);

    const id = type === 'movie'
        ? tmdbRes['movie_results'][0]?.id
        : tmdbRes['tv_results'][0]?.id;

    if (!id) {
        console.warn('❌ TMDB ID not found');
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
        extractor('vidfast', type, id, season, episode)
    ]);

    for (const result of [
        broflixResult, fmoviesResult, vidoraResult,
        videasyResult, viloraResult, vidsrcResult, vidfastResult
    ]) {
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
            description: `${metadata.Title} (${metadata.Year})`
        }));
    }
    const streams = await extractAllStreams({ type: 'movie', imdbId });
    streamCache.set(cacheKey, streams);

    return Object.entries(streams).map(([name, url]) => ({
        name,
        url,
        description: `${metadata.Title} (${metadata.Year})`
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
            description: `${metadata.Title} S${season}E${episode}`
        }));
    }

    const streams = await extractAllStreams({ type: 'series', imdbId, season, episode });
    return Object.entries(streams).map(([name, url]) => ({
        name,
        url,
        description: `${metadata.Title} S${season}E${episode}`
    }));
}

builder.defineStreamHandler(async ({type, id}) => {
    try {
        if (type === 'movie') {
            const imdbId = id.split(':')[0];
            const streams = await getMovieStreams(imdbId);
            return Promise.resolve( { streams });
        }
        if (type === 'series') {
            const [imdbId, season, episode] = id.split(':');
            const streams = await getSeriesStreams(imdbId, season, episode);
            return Promise.resolve({ streams });
        }
        return { streams: [] };
    } catch (error) {
        return Promise.resolve({ streams: [] });
    }
});

module.exports = async (req, res) => {
    if (req.url === '/manifest.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(builder.getInterface().manifest));
        return;
    }

    if (req.url.startsWith('/stream/')) {
        const [ , resource, type, ...idParts ] = req.url.split('/');
        const id = idParts.join('/');
        if (resource === 'stream') {
            const { streams } = await builder.getInterface().get('stream')({ type, id });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ streams }));
            return;
        }
    }

    res.statusCode = 404;
    res.end('Not found');
}; 
