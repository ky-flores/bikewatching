import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken = 'pk.eyJ1Ijoia3lmbG9yZXMiLCJhIjoiY21hcWF4YWl5MDd5ZDJpb2d5Z3ozZXc3cSJ9.Ww-YQUys6y_BEvwJDctcbw';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

map.on('load', async () => {
  // --- Add bike lanes ---
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });

  const bikeLaneStyle = {
    'line-color': '#008000',
    'line-width': 3,
    'line-opacity': 0.3
  };

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle
  });

  // --- Select SVG for stations ---
  const svg = d3.select('#map').select('svg');

  // --- Load Bluebike stations ---
  let stations = [];
  let trips = await d3.csv(
        'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
        (trip) => {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
            return trip;
        },
    );

  let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const jsonData = await d3.json(jsonurl);

    stations = computeStationTraffic(jsonData.data.stations, trips);
    console.log('Loaded Stations:', stations);
  } catch (error) {
    console.error('Error loading stations JSON:', error);
  }

  const radiusScale = d3
  .scaleSqrt()
  .domain([0, d3.max(stations, d => d.totalTraffic)])
  .range([0, 25]);

  // --- Draw circles ---
  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', d => radiusScale(d.totalTraffic))
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.6)
    .style('pointer-events', 'visiblePainted')
    .style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic || 0)
    )
    .each(function (d) {
    // Add <title> for browser tooltips
    d3.select(this)
      .append('title')
      .text(
        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
      );
    });


  function updatePositions() {
    circles
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

function updateTimeDisplay() {
  let timeFilter = Number(timeSlider.value); 

  if (timeFilter === -1) {
    selectedTime.textContent = ''; 
    anyTimeLabel.style.display = 'block'; 
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none'; 
  }

  updateScatterPlot(timeFilter);
}

timeSlider.addEventListener('input', updateTimeDisplay);
updateTimeDisplay(); 

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips // If no filter is applied (-1), return all trips
    : trips.filter((trip) => {
        // Convert trip start and end times to minutes since midnight
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);

        // Include trips that started or ended within 60 minutes of the selected time
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

function updateScatterPlot(timeFilter) {
  // Get only the trips that match the selected time filter
  const filteredTrips = filterTripsbyTime(trips, timeFilter);

  // Recompute station traffic based on the filtered trips
  const filteredStations = computeStationTraffic(stations, filteredTrips);

  timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

  // Update the scatterplot by adjusting the radius of circles
  circles
    .data(filteredStations, d => d.short_name)
    .attr('r', d => radiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) =>
    stationFlow(d.departures / d.totalTraffic || 0)
  );
}

});

// --- Coordinate projection ---
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(trips, v => v.length, d => d.start_station_id);
  const arrivals = d3.rollup(trips, v => v.length, d => d.end_station_id);

  return stations.map(station => {
    let id = station.short_name;
    station.departures = departures.get(id) ?? 0;
    station.arrivals = arrivals.get(id) ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}


let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);
