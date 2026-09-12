import { useState } from "react";
import axios from "axios";

function App() {

  const [resultado, setResultado] = useState(null);

  const evaluarPedido = async () => {

    const pedido = {
      pago: 65,
      distancia: 5.2,
      tiempo: 16
    };

    try {

      const respuesta = await axios.post(
        "http://localhost:5000/api/evaluar-baseline",
        pedido
      );

      setResultado(respuesta.data);

    } catch (error) {

      console.error(error);

    }
  };


  return (
    <div>

      <h1>🚚 SmartCourier AI</h1>

      <h2>📦 Pedido actual</h2>

      <p>💰 Pago: $65</p>

      <p>📍 Distancia: 5.2 km</p>

      <p>⏱ Tiempo: 16 minutos</p>


      <button onClick={evaluarPedido}>
        Evaluar pedido
      </button>


      {resultado && (

        <div>

          <h2>Resultado</h2>

          <p>
            Rentabilidad:
            ${resultado.rentabilidad} / min
          </p>

          <h2>
            {resultado.decision === "ACEPTAR"
              ? "✅ ACEPTAR"
              : "❌ RECHAZAR"}
          </h2>

        </div>

      )}

    </div>
  );
}

export default App;