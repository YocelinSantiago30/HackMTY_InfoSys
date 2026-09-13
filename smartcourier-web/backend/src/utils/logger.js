function log(tag, message) {
  console.log(`[${tag}] ${message}`);
}

module.exports = {
  log,
  simulation: (message) => log("SIMULATION", message),
  baseline: (message) => log("BASELINE", message),
  smart: (message) => log("SMART", message),
  event: (message) => log("EVENT", message),
  error: (message) => console.error(`[ERROR] ${message}`),
};
