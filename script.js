// --- Configuration & State ---
const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');
const width = canvas.width;
const height = canvas.height;

let isRunning = false;
let isReplaying = false;
let animationId = null;
let currentAlgorithm = null;
let iteration = 0;
let bestGlobalFitness = Infinity;
let bestGlobalPosition = null;
let executionCount = 0;

// History storage
let currentRunHistory = [];
let executionHistories = {}; // Map execution ID -> { history: [], color: string, functionName: string }

// --- Benchmark Functions ---
const functions = {
    sphere: {
        name: "Sphere",
        func: (x, y) => x*x + y*y,
        bounds: [-5.12, 5.12],
        globalMin: 0
    },
    rastrigin: {
        name: "Rastrigin",
        func: (x, y) => {
            const A = 10;
            return 2 * A + (x*x - A * Math.cos(2 * Math.PI * x)) + (y*y - A * Math.cos(2 * Math.PI * y));
        },
        bounds: [-5.12, 5.12],
        globalMin: 0
    },
    schwefel: {
        name: "Schwefel",
        func: (x, y) => {
            return 418.9829 * 2 - (x * Math.sin(Math.sqrt(Math.abs(x))) + y * Math.sin(Math.sqrt(Math.abs(y))));
        },
        bounds: [-500, 500],
        globalMin: 0
    },
    rosenbrock: {
        name: "Rosenbrock",
        func: (x, y) => {
            return Math.pow(1 - x, 2) + 100 * Math.pow(y - x*x, 2);
        },
        bounds: [-2, 2], // Usually evaluated on smaller range for visualization
        globalMin: 0
    },
    ackley: {
        name: "Ackley",
        func: (x, y) => {
            return -20 * Math.exp(-0.2 * Math.sqrt(0.5 * (x*x + y*y))) - Math.exp(0.5 * (Math.cos(2*Math.PI*x) + Math.cos(2*Math.PI*y))) + Math.E + 20;
        },
        bounds: [-32.768, 32.768], // Standard bounds
        globalMin: 0
    }
};

let currentFunction = functions.sphere;

// --- Utils ---
function map(value, start1, stop1, start2, stop2) {
    return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
}

function random(min, max) {
    return Math.random() * (max - min) + min;
}

function gaussianRandom(mean=0, stdev=1) {
    const u = 1 - Math.random(); // Converting [0,1) to (0,1]
    const v = Math.random();
    const z = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    return z * stdev + mean;
}

// --- Visualization ---
// Cache background to improve performance
let backgroundCanvas = document.createElement('canvas');
backgroundCanvas.width = width;
backgroundCanvas.height = height;
let bgCtx = backgroundCanvas.getContext('2d');

function drawBackground() {
    const imgData = bgCtx.createImageData(width, height);
    const data = imgData.data;
    const bounds = currentFunction.bounds;
    
    // Find min/max for normalization (approximate for visualization)
    // We sample a grid to find min/max values to scale colors
    let minVal = Infinity;
    let maxVal = -Infinity;
    const step = 5; // Sample every 5 pixels for speed
    
    for (let py = 0; py < height; py += step) {
        for (let px = 0; px < width; px += step) {
            const x = map(px, 0, width, bounds[0], bounds[1]);
            const y = map(py, 0, height, bounds[0], bounds[1]);
            const val = currentFunction.func(x, y);
            if (val < minVal) minVal = val;
            if (val > maxVal) maxVal = val;
        }
    }

    // Draw full resolution
    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const x = map(px, 0, width, bounds[0], bounds[1]);
            const y = map(py, 0, height, bounds[0], bounds[1]);
            const val = currentFunction.func(x, y);
            
            // Normalize value for color (log scale often looks better for optimization functions)
            // Simple linear interpolation for now, maybe log for large ranges
            let norm = (val - minVal) / (maxVal - minVal);
            if (maxVal - minVal === 0) norm = 0;
            
            // Viridis-like colormap (approximate)
            // Low values (good) -> Purple/Blue
            // High values (bad) -> Yellow/Green
            
            // Simple heatmap: Blue (low) -> Red (high)
            // Or Grayscale
            // Let's try a custom map: Dark Blue -> Blue -> Cyan -> Green -> Yellow
            
            const index = (py * width + px) * 4;
            
            // Simple coloring: 
            // 0.0 -> 0, 0, 255 (Blue)
            // 0.5 -> 0, 255, 0 (Green)
            // 1.0 -> 255, 255, 0 (Yellow)
            
            // Using a non-linear mapping to emphasize minima
            const colorNorm = Math.pow(norm, 0.3); // Gamma correction-ish
            
            const r = Math.floor(colorNorm * 255);
            const g = Math.floor((1 - Math.abs(colorNorm - 0.5) * 2) * 100 + 100);
            const b = Math.floor((1 - colorNorm) * 255);

            data[index] = r;     // R
            data[index + 1] = g; // G
            data[index + 2] = b; // B
            data[index + 3] = 255; // Alpha
        }
    }
    bgCtx.putImageData(imgData, 0, 0);
    
    // Draw Global Min marker
    // Assuming global min is at 0,0 for most, but Schwefel is different
    let minX = 0, minY = 0;
    if (currentFunction.name === "Schwefel") {
        minX = 420.9687;
        minY = 420.9687;
    }
    
    const cx = map(minX, bounds[0], bounds[1], 0, width);
    const cy = map(minY, bounds[0], bounds[1], 0, height);
    
    bgCtx.beginPath();
    bgCtx.arc(cx, cy, 5, 0, Math.PI * 2);
    bgCtx.fillStyle = 'white';
    bgCtx.fill();
    bgCtx.strokeStyle = 'black';
    bgCtx.stroke();
}

function render(populationOverride = null, colorOverride = null) {
    // Draw cached background
    ctx.drawImage(backgroundCanvas, 0, 0);
    
    const bounds = currentFunction.bounds;
    let population = null;
    let color = 'red';

    if (populationOverride) {
        population = populationOverride;
        color = colorOverride || 'red';
    } else if (currentAlgorithm) {
        population = currentAlgorithm.getPopulation();
        color = currentAlgorithm.color;
    }

    // Draw particles/individuals
    if (population) {
        population.forEach(ind => {
            const px = map(ind.x, bounds[0], bounds[1], 0, width);
            const py = map(ind.y, bounds[0], bounds[1], 0, height);
            
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        });

        // Draw current best (only in live mode for now, or if we tracked it in history)
        // For replay, we might not have the exact "best" position easily accessible unless we stored it.
        // But we can just show the population.
        if (!populationOverride && bestGlobalPosition) {
            const bx = map(bestGlobalPosition[0], bounds[0], bounds[1], 0, width);
            const by = map(bestGlobalPosition[1], bounds[0], bounds[1], 0, height);
            
            ctx.beginPath();
            ctx.moveTo(bx - 6, by - 6);
            ctx.lineTo(bx + 6, by + 6);
            ctx.moveTo(bx + 6, by - 6);
            ctx.lineTo(bx - 6, by + 6);
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    // Draw Axis Limits
    ctx.font = '12px monospace';
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    
    const drawLabel = (text, x, y, align, baseline) => {
        ctx.textAlign = align;
        ctx.textBaseline = baseline;
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
    };

    // Top-Left (Min X, Min Y)
    drawLabel(`(${bounds[0]}, ${bounds[0]})`, 5, 5, 'left', 'top');
    
    // Top-Right (Max X, Min Y)
    drawLabel(`(${bounds[1]}, ${bounds[0]})`, width - 5, 5, 'right', 'top');
    
    // Bottom-Left (Min X, Max Y)
    drawLabel(`(${bounds[0]}, ${bounds[1]})`, 5, height - 5, 'left', 'bottom');
    
    // Bottom-Right (Max X, Max Y)
    drawLabel(`(${bounds[1]}, ${bounds[1]})`, width - 5, height - 5, 'right', 'bottom');
}

// --- Algorithms ---

class GA {
    constructor(popSize, mutationRate, crossoverRate, elitism) {
        this.popSize = popSize;
        this.mutationRate = mutationRate;
        this.crossoverRate = crossoverRate;
        this.elitism = elitism;
        this.color = '#e74c3c'; // Red
        this.population = [];
        this.bounds = currentFunction.bounds;
        
        // Initialize
        for (let i = 0; i < popSize; i++) {
            this.population.push({
                x: random(this.bounds[0], this.bounds[1]),
                y: random(this.bounds[0], this.bounds[1]),
                fitness: Infinity
            });
        }
        this.evaluate();
    }

    evaluate() {
        this.population.forEach(ind => {
            ind.fitness = currentFunction.func(ind.x, ind.y);
            if (ind.fitness < bestGlobalFitness) {
                bestGlobalFitness = ind.fitness;
                bestGlobalPosition = [ind.x, ind.y];
            }
        });
        // Sort for selection
        this.population.sort((a, b) => a.fitness - b.fitness);
    }

    step() {
        const newPop = [];
        
        // Elitism
        if (this.elitism) {
            newPop.push({...this.population[0]}); // Keep best
        }

        while (newPop.length < this.popSize) {
            // Tournament Selection
            const p1 = this.tournamentSelect();
            const p2 = this.tournamentSelect();
            
            // Crossover
            let c1 = { ...p1 };
            let c2 = { ...p2 };
            
            if (Math.random() < this.crossoverRate) {
                // Simple arithmetic crossover or point crossover
                // Let's use simple blending for continuous GA
                const alpha = Math.random();
                c1.x = alpha * p1.x + (1 - alpha) * p2.x;
                c1.y = alpha * p1.y + (1 - alpha) * p2.y;
                
                c2.x = alpha * p2.x + (1 - alpha) * p1.x;
                c2.y = alpha * p2.y + (1 - alpha) * p1.y;
            }
            
            // Mutation
            this.mutate(c1);
            this.mutate(c2);
            
            newPop.push(c1);
            if (newPop.length < this.popSize) newPop.push(c2);
        }
        
        this.population = newPop;
        this.evaluate();
    }

    tournamentSelect() {
        const k = 3;
        let best = null;
        for (let i = 0; i < k; i++) {
            const ind = this.population[Math.floor(Math.random() * this.popSize)];
            if (!best || ind.fitness < best.fitness) {
                best = ind;
            }
        }
        return best;
    }

    mutate(ind) {
        const range = this.bounds[1] - this.bounds[0];
        if (Math.random() < this.mutationRate) {
            ind.x += gaussianRandom(0, range * 0.05); // Small gaussian perturbation
            ind.x = Math.max(this.bounds[0], Math.min(this.bounds[1], ind.x));
        }
        if (Math.random() < this.mutationRate) {
            ind.y += gaussianRandom(0, range * 0.05);
            ind.y = Math.max(this.bounds[0], Math.min(this.bounds[1], ind.y));
        }
    }

    getPopulation() {
        return this.population;
    }
}

class PSO {
    constructor(swarmSize, w, c1, c2) {
        this.swarmSize = swarmSize;
        this.w = w;
        this.c1 = c1;
        this.c2 = c2;
        this.color = '#3498db'; // Blue
        this.particles = [];
        this.bounds = currentFunction.bounds;
        
        // Initialize
        for (let i = 0; i < swarmSize; i++) {
            const p = {
                x: random(this.bounds[0], this.bounds[1]),
                y: random(this.bounds[0], this.bounds[1]),
                vx: random(-1, 1),
                vy: random(-1, 1),
                pbestX: 0,
                pbestY: 0,
                pbestFit: Infinity,
                fitness: Infinity
            };
            p.pbestX = p.x;
            p.pbestY = p.y;
            this.particles.push(p);
        }
        this.evaluate();
    }

    evaluate() {
        this.particles.forEach(p => {
            p.fitness = currentFunction.func(p.x, p.y);
            
            // Update Personal Best
            if (p.fitness < p.pbestFit) {
                p.pbestFit = p.fitness;
                p.pbestX = p.x;
                p.pbestY = p.y;
            }

            // Update Global Best
            if (p.fitness < bestGlobalFitness) {
                bestGlobalFitness = p.fitness;
                bestGlobalPosition = [p.x, p.y];
            }
        });
    }

    step() {
        this.particles.forEach(p => {
            const r1 = Math.random();
            const r2 = Math.random();
            
            // Update Velocity
            // v = w*v + c1*r1*(pbest - x) + c2*r2*(gbest - x)
            p.vx = this.w * p.vx + 
                   this.c1 * r1 * (p.pbestX - p.x) + 
                   this.c2 * r2 * (bestGlobalPosition[0] - p.x);
                   
            p.vy = this.w * p.vy + 
                   this.c1 * r1 * (p.pbestY - p.y) + 
                   this.c2 * r2 * (bestGlobalPosition[1] - p.y);
            
            // Limit velocity? (Optional but good practice)
            // const maxV = (this.bounds[1] - this.bounds[0]) * 0.1;
            // p.vx = Math.max(-maxV, Math.min(maxV, p.vx));
            // p.vy = Math.max(-maxV, Math.min(maxV, p.vy));

            // Update Position
            p.x += p.vx;
            p.y += p.vy;
            
            // Boundary handling (Clamp)
            p.x = Math.max(this.bounds[0], Math.min(this.bounds[1], p.x));
            p.y = Math.max(this.bounds[0], Math.min(this.bounds[1], p.y));
        });
        
        this.evaluate();
    }

    getPopulation() {
        return this.particles;
    }
}

// --- Main Loop ---

function captureState() {
    if (!currentAlgorithm) return [];
    // Deep copy positions
    return currentAlgorithm.getPopulation().map(p => ({x: p.x, y: p.y}));
}

function loop() {
    if (!isRunning) return;

    const speed = parseInt(document.getElementById('speedRange').value);
    
    currentAlgorithm.step();
    iteration++;
    
    // Capture history
    currentRunHistory.push(captureState());
    
    updateStats();
    render();
    
    // Stop condition
    const maxIter = parseInt(document.getElementById('maxIterations').value);
    if (maxIter > 0 && iteration >= maxIter) {
        stopSimulation(true);
        return;
    }

    // Speed control via setTimeout for next frame
    const delay = Math.max(0, 60 - speed); 
    
    if (delay === 0) {
        animationId = requestAnimationFrame(loop);
    } else {
        setTimeout(() => {
            animationId = requestAnimationFrame(loop);
        }, delay * 5); 
    }
}

function replayLoop(history, color) {
    if (!isReplaying) return;

    const speed = parseInt(document.getElementById('speedRange').value);
    
    if (iteration < history.length) {
        const pop = history[iteration];
        render(pop, color);
        
        document.getElementById('statIter').innerText = `${iteration} (Replay)`;
        // We don't have fitness history easily available unless we stored it too, 
        // so we just show iteration.
        
        iteration++;
        
        const delay = Math.max(0, 60 - speed);
        if (delay === 0) {
            animationId = requestAnimationFrame(() => replayLoop(history, color));
        } else {
            setTimeout(() => {
                animationId = requestAnimationFrame(() => replayLoop(history, color));
            }, delay * 5);
        }
    } else {
        // End of replay
        isReplaying = false;
        document.getElementById('btnRun').disabled = false;
        document.getElementById('btnStop').disabled = true;
        document.getElementById('algorithmSelect').disabled = false;
        document.getElementById('functionSelect').disabled = false;
        alert("Replay finalizado!");
    }
}

function updateStats() {
    document.getElementById('statIter').innerText = iteration;
    document.getElementById('statBestFit').innerText = bestGlobalFitness.toExponential(4);
    document.getElementById('statGlobalBest').innerText = bestGlobalFitness.toExponential(4);
}

function startSimulation() {
    if (isRunning || isReplaying) return;
    
    const algoType = document.getElementById('algorithmSelect').value;
    
    // Reset if starting fresh
    if (!currentAlgorithm) {
        resetSimulation(false);
        
        if (algoType === 'ga') {
            const popSize = parseInt(document.getElementById('gaPopSize').value);
            const mutRate = parseFloat(document.getElementById('gaMutation').value);
            const crossRate = parseFloat(document.getElementById('gaCrossover').value);
            const elitism = document.getElementById('gaElitism').checked;
            currentAlgorithm = new GA(popSize, mutRate, crossRate, elitism);
        } else {
            const swarmSize = parseInt(document.getElementById('psoSwarmSize').value);
            const w = parseFloat(document.getElementById('psoW').value);
            const c1 = parseFloat(document.getElementById('psoC1').value);
            const c2 = parseFloat(document.getElementById('psoC2').value);
            currentAlgorithm = new PSO(swarmSize, w, c1, c2);
        }
        
        // Capture initial state (Gen 0)
        currentRunHistory = [captureState()];
    }

    isRunning = true;
    document.getElementById('btnRun').disabled = true;
    document.getElementById('btnStop').disabled = false;
    document.getElementById('algorithmSelect').disabled = true;
    document.getElementById('functionSelect').disabled = true;
    
    loop();
}

function startReplay(id) {
    if (isRunning || isReplaying) return;
    
    const data = executionHistories[id];
    if (!data) return;
    
    // Setup for replay
    isReplaying = true;
    iteration = 0;
    
    // Set function to the one used in the run
    // Note: This changes the current view context!
    if (currentFunction.name !== data.functionName) {
        // Find function object by name
        for (let key in functions) {
            if (functions[key].name === data.functionName) {
                currentFunction = functions[key];
                document.getElementById('functionSelect').value = key;
                drawBackground();
                break;
            }
        }
    } else {
        // Just redraw background to clear any current particles
        drawBackground();
    }
    
    document.getElementById('btnRun').disabled = true;
    document.getElementById('btnStop').disabled = false; // Allow stopping replay?
    // Actually let's use Stop button to stop replay too
    
    document.getElementById('algorithmSelect').disabled = true;
    document.getElementById('functionSelect').disabled = true;
    
    replayLoop(data.history, data.color);
}

function stopSimulation(shouldLog = true) {
    if (isReplaying) {
        isReplaying = false;
        cancelAnimationFrame(animationId);
        document.getElementById('btnRun').disabled = false;
        document.getElementById('btnStop').disabled = true;
        document.getElementById('algorithmSelect').disabled = false;
        document.getElementById('functionSelect').disabled = false;
        return;
    }

    isRunning = false;
    cancelAnimationFrame(animationId);
    document.getElementById('btnRun').disabled = false;
    document.getElementById('btnStop').disabled = true;
    
    // Log result
    if (shouldLog && iteration > 0) {
        logResult();
    }
}

function resetSimulation(clearLog = false) {
    stopSimulation(false);
    currentAlgorithm = null;
    iteration = 0;
    bestGlobalFitness = Infinity;
    bestGlobalPosition = null;
    currentRunHistory = [];
    
    document.getElementById('statIter').innerText = '0';
    document.getElementById('statBestFit').innerText = '-';
    document.getElementById('statGlobalBest').innerText = '-';
    
    document.getElementById('algorithmSelect').disabled = false;
    document.getElementById('functionSelect').disabled = false;
    
    // Redraw background (clears particles)
    render();
}

function logResult() {
    executionCount++;
    
    // Save history
    executionHistories[executionCount] = {
        history: currentRunHistory,
        color: currentAlgorithm.color,
        functionName: currentFunction.name
    };

    const tbody = document.querySelector('#resultsTable tbody');
    const row = document.createElement('tr');
    
    const algoType = document.getElementById('algorithmSelect').value.toUpperCase();
    const funcName = currentFunction.name;
    
    let params = "";
    if (algoType === 'GA') {
        params = `Pop=${document.getElementById('gaPopSize').value}, Mut=${document.getElementById('gaMutation').value}`;
    } else {
        params = `Swarm=${document.getElementById('psoSwarmSize').value}, w=${document.getElementById('psoW').value}`;
    }
    
    row.innerHTML = `
        <td>${executionCount}</td>
        <td>${algoType}</td>
        <td>${funcName}</td>
        <td>${iteration}</td>
        <td>${bestGlobalFitness.toExponential(4)}</td>
        <td>${params}</td>
        <td><button onclick="startReplay(${executionCount})" class="tertiary" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">▶ Replay</button></td>
    `;
    
    tbody.insertBefore(row, tbody.firstChild);
}

// --- Event Listeners ---

document.getElementById('btnRun').addEventListener('click', startSimulation);
document.getElementById('btnStop').addEventListener('click', stopSimulation);
document.getElementById('btnReset').addEventListener('click', () => resetSimulation(false));

document.getElementById('algorithmSelect').addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'ga') {
        document.getElementById('gaParams').classList.remove('hidden');
        document.getElementById('psoParams').classList.add('hidden');
    } else {
        document.getElementById('gaParams').classList.add('hidden');
        document.getElementById('psoParams').classList.remove('hidden');
    }
    resetSimulation();
});

document.getElementById('functionSelect').addEventListener('change', (e) => {
    currentFunction = functions[e.target.value];
    drawBackground();
    resetSimulation();
});

// Initial Setup
drawBackground();
render();
