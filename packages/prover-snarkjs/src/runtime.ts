// ffjavascript reads this while building the curve thread pool; single-thread avoids leaked workers.
(process as unknown as { browser?: boolean }).browser = true;
export const groth16Promise = import("snarkjs").then((module) => module.groth16);
