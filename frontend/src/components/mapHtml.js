// HTML autocontenido que corre dentro del WebView. Usa Leaflet + OpenStreetMap
// (sección 13 del prompt). La comunicación con React Native va en dos vías:
//
// RN -> WebView: injectJavaScript(`window.setCourierPosition(lat, lng)`)
// WebView -> RN: window.ReactNativeWebView.postMessage(JSON.stringify({...}))
export function buildLeafletHtml({ latitude, longitude, markerLabel }) {
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link
      rel="stylesheet"
      href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
    />
    <style>
      html, body, #map { height: 100%; margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      const map = L.map('map', { zoomControl: false }).setView(
        [${latitude}, ${longitude}],
        15
      );

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      const courierIcon = L.divIcon({
        className: 'courier-marker',
        html: '🛵',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      let courierMarker = L.marker([${latitude}, ${longitude}], {
        icon: courierIcon,
      })
        .addTo(map)
        .bindPopup(${JSON.stringify(markerLabel || "Tú")});

      window.setCourierPosition = function (lat, lng) {
        courierMarker.setLatLng([lat, lng]);
        map.panTo([lat, lng]);
      };

      window.centerMap = function (lat, lng, zoom) {
        map.setView([lat, lng], zoom || map.getZoom());
      };

      map.on('click', function (event) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(
            JSON.stringify({
              type: 'MAP_CLICK',
              lat: event.latlng.lat,
              lng: event.latlng.lng,
            })
          );
        }
      });
    </script>
  </body>
</html>
`;
}
