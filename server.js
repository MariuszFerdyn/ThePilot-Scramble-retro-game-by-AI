// server.js - WebSocket Game Server for Retro Commando
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files (your game HTML)
app.use(express.static('public'));

// Game state
let gameState = {
    players: new Map(),
    enemies: [],
    bullets: [],
    powerups: [],
    explosions: [],
    wave: 1,
    gameOver: false,
    enemySpawnTimer: 0,
    enemySpawnRate: 90,
    powerupSpawnTimer: 0
};

let gameLoop;
let playerIdCounter = 0;

// Player class
class Player {
    constructor(id, name, ws) {
        this.id = id;
        this.name = name;
        this.ws = ws;
        this.x = 100 + (gameState.players.size * 50);
        this.y = 250 + (gameState.players.size * 100);
        this.width = 24;
        this.height = 32;
        this.speed = 5;
        this.lives = 3;
        this.score = 0;
        this.respawnTimer = 0;
        this.shootCooldown = 0;
        this.input = {
            left: false,
            right: false,
            up: false,
            down: false,
            shoot: false
        };
    }
}

// Bullet class
class Bullet {
    constructor(x, y, direction, playerId) {
        this.x = x;
        this.y = y;
        this.width = 8;
        this.height = 3;
        this.speed = 8 * direction;
        this.playerId = playerId;
        this.direction = direction;
    }
    
    update() {
        this.x += this.speed;
    }
}

// Enemy class
class Enemy {
    constructor() {
        this.x = 1000;
        this.y = Math.random() * (600 - 100) + 50;
        this.width = 28;
        this.height = 24;
        this.speed = 1.5 + Math.random() * 2 + (gameState.wave * 0.3);
        this.health = 1;
        this.shootTimer = Math.random() * 80;
        this.type = Math.random() < 0.8 ? 'normal' : 'fast';
        
        if (this.type === 'fast') {
            this.speed *= 1.5;
            this.width = 20;
            this.height = 20;
        }
    }
    
    update() {
        this.x -= this.speed;
        
        // Enemy shooting
        this.shootTimer--;
        if (this.shootTimer <= 0 && this.x < 900) {
            gameState.bullets.push(new Bullet(this.x, this.y + this.height/2, -1, 'enemy'));
            this.shootTimer = 60 + Math.random() * 60;
        }
    }
}

// Powerup class
class Powerup {
    constructor() {
        this.x = 1000;
        this.y = Math.random() * (600 - 100) + 50;
        this.width = 16;
        this.height = 16;
        this.speed = 2;
        this.type = Math.random() < 0.7 ? 'health' : 'points';
    }
    
    update() {
        this.x -= this.speed;
    }
}

// Explosion class
class Explosion {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.timer = 30;
        this.particles = [];
        
        for (let i = 0; i < 6; i++) {
            this.particles.push({
                x: x,
                y: y,
                vx: (Math.random() - 0.5) * 8,
                vy: (Math.random() - 0.5) * 8,
                life: 30
            });
        }
    }
    
    update() {
        this.timer--;
        this.particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.life--;
            p.vx *= 0.98;
            p.vy *= 0.98;
        });
    }
}

// Collision detection
function checkCollision(obj1, obj2) {
    // Safety check for undefined objects
    if (!obj1 || !obj2 || 
        typeof obj1.x === 'undefined' || typeof obj1.y === 'undefined' || 
        typeof obj2.x === 'undefined' || typeof obj2.y === 'undefined' ||
        typeof obj1.width === 'undefined' || typeof obj1.height === 'undefined' ||
        typeof obj2.width === 'undefined' || typeof obj2.height === 'undefined') {
        return false;
    }
    
    return obj1.x < obj2.x + obj2.width &&
           obj1.x + obj1.width > obj2.x &&
           obj1.y < obj2.y + obj2.height &&
           obj1.y + obj1.height > obj2.y;
}

// Update player based on input
function updatePlayer(player) {
    if (player.respawnTimer > 0) {
        player.respawnTimer--;
        return;
    }
    
    // Movement
    if (player.input.left && player.x > 0) {
        player.x -= player.speed;
    }
    if (player.input.right && player.x < 1000 - player.width) {
        player.x += player.speed;
    }
    if (player.input.up && player.y > 0) {
        player.y -= player.speed;
    }
    if (player.input.down && player.y < 600 - player.height) {
        player.y += player.speed;
    }
    
    // Shooting
    if (player.input.shoot && player.shootCooldown <= 0) {
        gameState.bullets.push(new Bullet(
            player.x + player.width, 
            player.y + player.height/2, 
            1, 
            player.id
        ));
        player.shootCooldown = 10;
    }
    
    if (player.shootCooldown > 0) {
        player.shootCooldown--;
    }
}

// Update enemies
function updateEnemies() {
    // Spawn enemies
    gameState.enemySpawnTimer++;
    if (gameState.enemySpawnTimer > gameState.enemySpawnRate) {
        gameState.enemies.push(new Enemy());
        gameState.enemySpawnTimer = 0;
        
        if (gameState.enemySpawnRate > 30) {
            gameState.enemySpawnRate--;
        }
    }
    
    // Update existing enemies
    for (let i = gameState.enemies.length - 1; i >= 0; i--) {
        gameState.enemies[i].update();
        
        // Remove off-screen enemies
        if (gameState.enemies[i].x < -gameState.enemies[i].width) {
            gameState.enemies.splice(i, 1);
        }
    }
    
    // Check for wave completion
    if (gameState.enemies.length === 0 && gameState.enemySpawnTimer === 0) {
        gameState.wave++;
        gameState.enemySpawnRate = Math.max(30, 90 - (gameState.wave * 5));
    }
}

// Update bullets
function updateBullets() {
    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        // Check if bullet still exists
        if (!gameState.bullets[i]) continue;
        
        gameState.bullets[i].update();
        
        // Remove off-screen bullets
        if (gameState.bullets[i].x < 0 || gameState.bullets[i].x > 1000) {
            gameState.bullets.splice(i, 1);
            continue;
        }
        
        // Check bullet-enemy collisions
        if (gameState.bullets[i] && gameState.bullets[i].direction > 0) { // Player bullet
            for (let j = gameState.enemies.length - 1; j >= 0; j--) {
                if (gameState.enemies[j] && gameState.bullets[i] && checkCollision(gameState.bullets[i], gameState.enemies[j])) {
                    // Hit enemy
                    gameState.explosions.push(new Explosion(
                        gameState.enemies[j].x + gameState.enemies[j].width/2,
                        gameState.enemies[j].y + gameState.enemies[j].height/2
                    ));
                    
                    // Award points to player
                    const player = gameState.players.get(gameState.bullets[i].playerId);
                    if (player) {
                        let points = gameState.enemies[j].type === 'fast' ? 150 : 100;
                        player.score += points;
                    }
                    
                    gameState.enemies.splice(j, 1);
                    gameState.bullets.splice(i, 1);
                    break;
                }
            }
        } else if (gameState.bullets[i] && gameState.bullets[i].direction < 0) { // Enemy bullet
            let bulletRemoved = false;
            gameState.players.forEach(player => {
                if (!bulletRemoved && player && gameState.bullets[i] && player.respawnTimer <= 0 && checkCollision(gameState.bullets[i], player)) {
                    // Hit player
                    gameState.explosions.push(new Explosion(
                        player.x + player.width/2,
                        player.y + player.height/2
                    ));
                    
                    player.lives--;
                    if (player.lives > 0) {
                        player.respawnTimer = 120;
                        player.x = 100;
                        player.y = 250;
                    }
                    
                    gameState.bullets.splice(i, 1);
                    bulletRemoved = true;
                }
            });
        }
    }
}

// Update powerups
function updatePowerups() {
    // Spawn powerups
    gameState.powerupSpawnTimer++;
    if (gameState.powerupSpawnTimer > 400) {
        gameState.powerups.push(new Powerup());
        gameState.powerupSpawnTimer = 0;
    }
    
    // Update existing powerups
    for (let i = gameState.powerups.length - 1; i >= 0; i--) {
        gameState.powerups[i].update();
        
        // Remove off-screen powerups
        if (gameState.powerups[i].x < -gameState.powerups[i].width) {
            gameState.powerups.splice(i, 1);
            continue;
        }
        
        // Check player collisions
        gameState.players.forEach(player => {
            if (player.respawnTimer <= 0 && checkCollision(player, gameState.powerups[i])) {
                if (gameState.powerups[i].type === 'health') {
                    player.lives++;
                } else {
                    player.score += 200;
                }
                gameState.powerups.splice(i, 1);
            }
        });
    }
}

// Update explosions
function updateExplosions() {
    for (let i = gameState.explosions.length - 1; i >= 0; i--) {
        gameState.explosions[i].update();
        if (gameState.explosions[i].timer <= 0) {
            gameState.explosions.splice(i, 1);
        }
    }
}

// Check game over
function checkGameOver() {
    let alivePlayers = 0;
    gameState.players.forEach(player => {
        if (player.lives > 0) alivePlayers++;
    });
    
    if (alivePlayers === 0 && gameState.players.size > 0) {
        gameState.gameOver = true;
    }
}

// Main game update loop
function updateGame() {
    if (gameState.gameOver) return;
    
    // Update all players
    gameState.players.forEach(updatePlayer);
    
    // Update game objects
    updateEnemies();
    updateBullets();
    updatePowerups();
    updateExplosions();
    
    // Check game over
    checkGameOver();
    
    // Send game state to all players
    broadcastGameState();
}

// Broadcast game state to all connected players
function broadcastGameState() {
    const state = {
        type: 'gameState',
        gameState: {
            wave: gameState.wave,
            gameOver: gameState.gameOver,
            players: Array.from(gameState.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                x: p.x,
                y: p.y,
                lives: p.lives,
                score: p.score,
                respawnTimer: p.respawnTimer
            })),
            enemies: gameState.enemies,
            bullets: gameState.bullets,
            powerups: gameState.powerups,
            explosions: gameState.explosions
        }
    };
    
    gameState.players.forEach(player => {
        if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(state));
        }
    });
}

// Restart game
function restartGame() {
    gameState.enemies = [];
    gameState.bullets = [];
    gameState.powerups = [];
    gameState.explosions = [];
    gameState.wave = 1;
    gameState.gameOver = false;
    gameState.enemySpawnTimer = 0;
    gameState.enemySpawnRate = 90;
    gameState.powerupSpawnTimer = 0;
    
    // Reset players
    let i = 0;
    gameState.players.forEach(player => {
        player.x = 100 + (i * 50);
        player.y = 250 + (i * 100);
        player.lives = 3;
        player.score = 0;
        player.respawnTimer = 0;
        i++;
    });
    
    broadcastGameState();
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('New player connected');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'join':
                    const playerId = `player_${++playerIdCounter}`;
                    const player = new Player(playerId, data.playerName, ws);
                    gameState.players.set(playerId, player);
                    
                    // Send player their ID and initial position
                    ws.send(JSON.stringify({
                        type: 'playerJoined',
                        playerId: playerId,
                        isHost: gameState.players.size === 1,
                        x: player.x,
                        y: player.y
                    }));
                    
                    console.log(`Player ${data.playerName} (${playerId}) joined`);
                    
                    // Start game loop if this is the first player
                    if (gameState.players.size === 1 && !gameLoop) {
                        gameLoop = setInterval(updateGame, 1000/60); // 60 FPS
                        console.log('Game loop started');
                    }
                    
                    broadcastGameState();
                    break;
                    
                case 'input':
                    const playerForInput = Array.from(gameState.players.values()).find(p => p.ws === ws);
                    if (playerForInput) {
                        playerForInput.input = data.input;
                    }
                    break;
                    
                case 'gameEvent':
                    if (data.eventType === 'restart') {
                        restartGame();
                    }
                    break;
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });
    
    ws.on('close', () => {
        // Remove player
        const playerToRemove = Array.from(gameState.players.entries())
            .find(([id, player]) => player.ws === ws);
            
        if (playerToRemove) {
            const [playerId, player] = playerToRemove;
            gameState.players.delete(playerId);
            console.log(`Player ${player.name} (${playerId}) disconnected`);
            
            // Stop game loop if no players
            if (gameState.players.size === 0 && gameLoop) {
                clearInterval(gameLoop);
                gameLoop = null;
                console.log('Game loop stopped');
            }
            
            // Notify remaining players
            gameState.players.forEach(p => {
                if (p.ws.readyState === WebSocket.OPEN) {
                    p.ws.send(JSON.stringify({
                        type: 'playerLeft',
                        playerId: playerId
                    }));
                }
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`WebSocket game server running on port ${PORT}`);
    console.log(`Players can connect to: ws://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    if (gameLoop) {
        clearInterval(gameLoop);
    }
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});