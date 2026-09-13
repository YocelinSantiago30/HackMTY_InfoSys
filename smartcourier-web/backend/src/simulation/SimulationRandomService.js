// Generador pseudoaleatorio determinista (mulberry32) sembrado con
// simulationSeed. Toda la aleatoriedad de la simulación (pedidos, eventos,
// tráfico, demanda) debe salir de aquí — nunca de Math.random() directo —
// para que la misma seed produzca siempre el mismo turno (sección 18).
class SimulationRandomService {
  constructor(seed) {
    this.state = seed >>> 0;
  }

  // Retorna un float en [0, 1)
  next() {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Entero en [min, max], ambos inclusive
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  // Float en [min, max)
  nextFloat(min, max) {
    return this.next() * (max - min) + min;
  }

  pick(array) {
    return array[this.nextInt(0, array.length - 1)];
  }
}

module.exports = SimulationRandomService;
