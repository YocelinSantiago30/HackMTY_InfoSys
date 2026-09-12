import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { buildLeafletHtml } from "./mapHtml";

const LeafletMap = forwardRef(function LeafletMap(
  { latitude, longitude, markerLabel, onMapClick },
  ref
) {
  const webViewRef = useRef(null);

  // El HTML solo se reconstruye una vez, con la posición inicial.
  // Las actualizaciones posteriores van por injectJavaScript, no por
  // reconstruir el WebView (eso reiniciaría el mapa cada vez).
  const initialHtml = useMemo(
    () => buildLeafletHtml({ latitude, longitude, markerLabel }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useImperativeHandle(ref, () => ({
    setCourierPosition(lat, lng) {
      webViewRef.current?.injectJavaScript(
        `window.setCourierPosition(${lat}, ${lng}); true;`
      );
    },
    centerMap(lat, lng, zoom) {
      webViewRef.current?.injectJavaScript(
        `window.centerMap(${lat}, ${lng}, ${zoom || ""}); true;`
      );
    },
  }));

  function handleMessage(event) {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      onMapClick?.(data);
    } catch (error) {
      // ignora mensajes que no sean JSON válido
    }
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
