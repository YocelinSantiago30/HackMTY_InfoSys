// HTML autocontenido que corre dentro del WebView con Leaflet + OpenStreetMap
// (sección 13). Comunicación:
//   RN -> WebView: injectJavaScript(`window.syncState(<json>)`)
//   WebView -> RN: postMessage({ type: "READY" | "MAP_CLICK", ... })
//
// Las rutas llegan en GeoJSON ([longitud, latitud], como las devuelve OSRM);
// Leaflet usa [latitud, longitud], así que se invierten aquí, en un solo lugar.
export function buildLeafletHtml({ latitude, longitude, agentColors }) {
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html, body, #map { height: 100%; margin: 0; padding: 0; }
      .courier { width: 26px; height: 26px; border-radius: 13px; border: 3px solid #fff;
        box-shadow: 0 1px 4px rgba(0,0,0,.45); color: #fff; font: bold 12px sans-serif;
        display: flex; align-items: center; justify-content: center; }
      .stop { width: 16px; height: 16px; border-radius: 8px; border: 3px solid #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,.4); color: #fff; font: bold 9px sans-serif;
        display: flex; align-items: center; justify-content: center; }
      .stop.dropoff { border-radius: 3px; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      // En el teléfono: puente de react-native-webview. En web: iframe → ventana padre.
      function post(message) {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
        else if (window.parent !== window) window.parent.postMessage(JSON.stringify(message), "*");
      }

      if (typeof L === "undefined") {
        post({ type: "ERROR", message: "No se pudo cargar Leaflet (¿sin internet?)" });
      } else {
        const COLORS = ${JSON.stringify(agentColors)};
        const LABELS = { BASELINE: "B", SMARTCOURIER: "S" };
        const map = L.map("map", { zoomControl: false }).setView([${latitude}, ${longitude}], 13);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap contributors",
          maxZoom: 19,
        }).addTo(map);

        const layers = {};
        let userMarker = null;

        function toLatLngs(coordinates) {
          return coordinates.map(function (point) { return [point[1], point[0]]; });
        }

        function courierIcon(code) {
          return L.divIcon({
            className: "",
            html: '<div class="courier" style="background:' + COLORS[code] + '">' + LABELS[code] + "</div>",
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          });
        }

        function stopIcon(code, stop) {
          const isPickup = stop.type === "PICKUP";
          return L.divIcon({
            className: "",
            html: '<div class="stop ' + (isPickup ? "pickup" : "dropoff") + '" style="background:' +
              (isPickup ? "#2e7d32" : COLORS[code]) + '">' + (isPickup ? "P" : "D") + "</div>",
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          });
        }

        function clearRoute(layer) {
          if (layer.line) { map.removeLayer(layer.line); layer.line = null; }
          layer.stops.forEach(function (m) { map.removeLayer(m); });
          layer.stops = [];
          layer.signature = null;
        }

        function drawRoute(code, layer, route) {
          clearRoute(layer);
          layer.line = L.polyline(toLatLngs(route.coordinates), {
            color: COLORS[code],
            weight: code === "SMARTCOURIER" ? 5 : 4,
            opacity: 0.85,
            dashArray: route.kind === "REPOSITION" ? "6 8" : null,
          }).addTo(map);

          layer.stops = route.stops
            .filter(function (s) { return s.type !== "REPOSITION"; })
            .map(function (s) {
              return L.marker([s.lat, s.lng], { icon: stopIcon(code, s) })
                .bindPopup((s.type === "PICKUP" ? "Recolección" : "Entrega") + " pedido #" + s.orderNumber)
                .addTo(map);
            });
        }

        function routeSignature(route) {
          return route ? route.kind + ":" + route.endSecond + ":" + JSON.stringify(route.stops) : null;
        }

        window.syncState = function (state) {
          let newSmartRoute = null;

          Object.keys(COLORS).forEach(function (code) {
            const layer = layers[code] || (layers[code] = { marker: null, line: null, stops: [], signature: null });
            const courier = state.couriers && state.couriers[code];
            const route = state.routes && state.routes[code];

            if (courier && courier.lat != null) {
              if (!layer.marker) {
                layer.marker = L.marker([courier.lat, courier.lng], { icon: courierIcon(code), zIndexOffset: 1000 }).addTo(map);
              } else {
                layer.marker.setLatLng([courier.lat, courier.lng]);
              }
            } else if (layer.marker) {
              map.removeLayer(layer.marker);
              layer.marker = null;
            }

            const signature = routeSignature(route);
            if (signature === layer.signature) return;
            if (!route) {
              clearRoute(layer);
              return;
            }
            drawRoute(code, layer, route);
            layer.signature = signature;
            if (code === "SMARTCOURIER") newSmartRoute = layer.line;
          });

          if (newSmartRoute && state.followRoutes) {
            map.fitBounds(newSmartRoute.getBounds(), { padding: [50, 50], maxZoom: 15 });
          }

          if (state.user) {
            if (!userMarker) {
              userMarker = L.circleMarker([state.user.lat, state.user.lng], {
                radius: 8, color: "#fff", weight: 3, fillColor: "#1976d2", fillOpacity: 1,
              }).bindPopup("Tú").addTo(map);
            } else {
              userMarker.setLatLng([state.user.lat, state.user.lng]);
            }
          } else if (userMarker) {
            map.removeLayer(userMarker);
            userMarker = null;
          }
        };

        window.centerMap = function (lat, lng, zoom) {
          map.setView([lat, lng], zoom || map.getZoom());
        };

        map.on("click", function (event) {
          post({ type: "MAP_CLICK", lat: event.latlng.lat, lng: event.latlng.lng });
        });

        post({ type: "READY" });
      }
    </script>
  </body>
</html>
`;
}
