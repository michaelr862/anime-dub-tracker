/**
 * Netlify Serverless Function — AnimeSchedule Timetable Proxy
 *
 * Receives requests from the PWA, forwards them to animeschedule.net
 * server-side (no CORS restriction), and returns the response.
 *
 * PWA calls: /.netlify/functions/timetable?airType=dub&tz=Australia/Sydney
 * This function calls: https://animeschedule.net/api/v3/timetables?airType=dub&tz=Australia/Sydney
 *
 * The Bearer token is sent from the PWA in the Authorization header
 * and forwarded directly to AnimeSchedule.
 */

exports.handler = async function(event) {
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Get the Authorization header from the incoming PWA request
  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing or invalid Authorization header' })
    };
  }

  // Forward query parameters (airType, tz) to AnimeSchedule
  const params = event.queryStringParameters || {};
  const airType = params.airType || 'dub';
  const tz      = params.tz || 'Australia/Sydney';

  const upstreamUrl = `https://animeschedule.net/api/v3/timetables?airType=${encodeURIComponent(airType)}&tz=${encodeURIComponent(tz)}`;

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json',
        'User-Agent': 'AnimeDubTracker/1.0'
      }
    });
  } catch (networkError) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to reach AnimeSchedule: ' + networkError.message })
    };
  }

  const responseText = await upstreamResponse.text();

  return {
    statusCode: upstreamResponse.status,
    headers: {
      'Content-Type': 'application/json',
      // Allow the PWA on any origin to call this function
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type'
    },
    body: responseText
  };
};
