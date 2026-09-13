import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { buildLeafletHtml } from "./mapHtml";
import { AGENT_COLORS } from "../constants/theme";

// Mapa declarativo: recibe repartidores, rutas y ubicación del usuario como
// props y los sincroniza con Leaflet. Nada se inyecta antes de que el WebView
// avise READY (antes se perdían las rutas si llegaban mientras cargaba).
const LeafletMap = forwardRef(function LeafletMap(
  { latitude, longitude, couriers, routes, user, followRoutes = true, onMapClick, onError },
  ref
) {
  const webViewRef = useRef(null);
  const [isReady, setIsReady] = useState(false);

  // El HTML se construye una sola vez: reconstruirlo reiniciaría el mapa.
  const initialHtml = useMemo(
    () => buildLeafletHtml({ latitude, longitude, agentColors: AGENT_COLORS }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (!isReady) return;
    const state = JSON.stringify({ couriers, routes, user, followRoutes });
    webViewRef.current?.injectJavaScript(`window.syncState(${state}); true;`);
  }, [isReady, couriers, routes, user, followRoutes]);

  useImperativeHandle(ref, () => ({
    centerMap(lat, lng, zoom) {
      if (!isReady) return;
      webViewRef.current?.injectJavaScript(`window.centerMap(${Number(lat)}, ${Number(lng)}, ${Number(zoom) || 0}); true;`);
    },
  }));

  function handleMessage(event) {
    let data;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch (error) {
      return; // mensaje que no es JSON
    }

    if (data.type === "READY") setIsReady(true);
    else if (data.type === "ERROR") onError?.(data.message);
    else if (data.type === "MAP_CLICK") onMapClick?.(data);
  }

  return (
    <WebView
      ref={webViewRef}
      originWhitelist={["*"]}
      source={{ html: initialHtml }}
      style={styles.webview}
      onMessage={handleMessage}
      javaScriptEnabled
      domStorageEnabled
    />
  );
});

export default LeafletMap;

const styles = StyleSheet.create({
  webview: {
    flex: 1,
  },
});
