import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { buildLeafletHtml } from "./mapHtml";
import { AGENT_COLORS } from "../constants/theme";

// Versión web de LeafletMap: react-native-webview no existe en el navegador,
// así que el mismo HTML de Leaflet corre en un iframe. Misma interfaz de props.
const LeafletMap = forwardRef(function LeafletMap(
  { latitude, longitude, couriers, routes, user, followRoutes = true, onMapClick, onError },
  ref
) {
  const iframeRef = useRef(null);
  const [isReady, setIsReady] = useState(false);

  const html = useMemo(
    () => buildLeafletHtml({ latitude, longitude, agentColors: AGENT_COLORS }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    function handleMessage(event) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      if (data.type === "READY") setIsReady(true);
      else if (data.type === "ERROR") onError?.(data.message);
      else if (data.type === "MAP_CLICK") onMapClick?.(data);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onError, onMapClick]);

  useEffect(() => {
    if (!isReady) return;
    iframeRef.current?.contentWindow?.syncState?.({ couriers, routes, user, followRoutes });
  }, [isReady, couriers, routes, user, followRoutes]);

  useImperativeHandle(ref, () => ({
    centerMap(lat, lng, zoom) {
      if (isReady) iframeRef.current?.contentWindow?.centerMap?.(Number(lat), Number(lng), Number(zoom) || 0);
    },
  }));

  return <iframe ref={iframeRef} title="Mapa" srcDoc={html} style={{ border: 0, flex: 1, width: "100%", height: "100%" }} />;
});

export default LeafletMap;
