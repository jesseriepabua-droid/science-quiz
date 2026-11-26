const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// Exact Round Rules: Easy (10s, 1pt), Average (15s, 3pts), Hard (22s, 5pts)
const ROUNDS = [
  { name: 'Easy Round', difficulty: 'easy', count: 10, time: 10, points: 1 },
  { name: 'Average Round', difficulty: 'medium', count: 8, time: 15, points: 3 },
  { name: 'Hard Round', difficulty: 'hard', count: 5, time: 22, points: 5 }
];

const FALLBACK_QUESTIONS = {
  easy: [
    { q: "What planet is known as the Red Planet?", correct: "Mars", incorrect: ["Venus", "Jupiter", "Saturn"] },
    { q: "What is the chemical symbol for water?", correct: "H2O", incorrect: ["CO2", "O2", "NaCl"] },
    { q: "What gas do plants absorb from the atmosphere for photosynthesis?", correct: "Carbon Dioxide", incorrect: ["Oxygen", "Nitrogen", "Hydrogen"] },
    { q: "What is the center of an atom called?", correct: "Nucleus", incorrect: ["Electron", "Proton", "Molecule"] },
    { q: "How many bones are in the adult human body?", correct: "206", incorrect: ["186", "226", "250"] },
    { q: "What force keeps planets in orbit around the Sun?", correct: "Gravity", incorrect: ["Magnetism", "Friction", "Inertia"] },
    { q: "Which organ pumps blood throughout the human body?", correct: "Heart", incorrect: ["Lungs", "Liver", "Brain"] },
    { q: "What is the boiling point of water at sea level?", correct: "100°C", incorrect: ["50°C", "90°C", "120°C"] },
    { q: "Which star is closest to Earth?", correct: "The Sun", incorrect: ["Proxima Centauri", "Sirius", "Polaris"] },
    { q: "What is the hardest natural substance on Earth?", correct: "Diamond", incorrect: ["Quartz", "Gold", "Iron"] }
  ],
  medium: [
    { q: "What is the powerhouse of the cell?", correct: "Mitochondria", incorrect: ["Ribosome", "Golgi apparatus", "Lysosome"] },
    { q: "Which element has the atomic number 79?", correct: "Gold", incorrect: ["Silver", "Platinum", "Mercury"] },
    { q: "What is the speed of light in a vacuum (approx.)?", correct: "300,000 km/s", incorrect: ["150,000 km/s", "30,000 km/s", "3,000,000 km/s"] },
    { q: "Which blood type is known as the universal donor?", correct: "O negative", incorrect: ["AB positive", "A negative", "B positive"] },
    { q: "What part of the brain regulates balance and coordination?", correct: "Cerebellum", incorrect: ["Cerebrum", "Medulla", "Hypothalamus"] },
    { q: "What is the most abundant gas in Earth's atmosphere?", correct: "Nitrogen", incorrect: ["Oxygen", "Carbon Dioxide", "Argon"] },
    { q: "What type of bond involves the sharing of electron pairs between atoms?", correct: "Covalent bond", incorrect: ["Ionic bond", "Metallic bond", "Hydrogen bond"] },
    { q: "Which planet has the most moons in our solar system?", correct: "Saturn", incorrect: ["Jupiter", "Uranus", "Neptune"] }
  ],
  hard: [
    { q: "What is the theoretical boundary around a black hole beyond which nothing can escape?", correct: "Event Horizon", incorrect: ["Singularity", "Schwarzschild Radius", "Accretion Disk"] },
    { q: "Which subatomic particle was discovered by James Chadwick in 1932?", correct: "Neutron", incorrect: ["Positron", "Muon", "Neutrino"] },
    { q: "What enzyme is responsible for unzipping the DNA double helix during replication?", correct: "Helicase", incorrect: ["Polymerase", "Ligase", "Primase"] },
    { q: "What is the SI unit of electrical capacitance?", correct: "Farad", incorrect: ["Henry", "Siemens", "Weber"] },
    { q: "Which law states that the entropy of an isolated system never decreases?", correct: "Second Law of Thermodynamics", incorrect: ["First Law of Thermodynamics", "Zeroth Law", "Third Law"] }
  ]
};

const rooms = new Map();

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Statistical Math Helpers
function computeMean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function computeStdDev(values) {
  if (values.length <= 1) return 0;
  const mean = computeMean(values);
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function computePlayerStats(player, totalQuestions) {
  const accuracy = totalQuestions > 0 ? (player.correctCount / totalQuestions) * 100 : 0;
  const meanTime = player.responseTimes.length > 0 ? computeMean(player.responseTimes) : 999;
  const stdDevTime = player.responseTimes.length > 0 ? computeStdDev(player.responseTimes) : 0;

  return {
    id: player.id,
    name: player.name,
    score: Number(player.score) || 0,
    correctCount: player.correctCount,
    totalQuestions,
    accuracy: Number(accuracy.toFixed(1)),
    meanTime: player.responseTimes.length > 0 ? Number(meanTime.toFixed(2)) : null,
    stdDevTime: player.responseTimes.length > 0 ? Number(stdDevTime.toFixed(2)) : null
  };
}

// Statistical Ranking Comparator:
// 1. Highest Total Score
// 2. Highest Accuracy %
// 3. Fastest Mean Response Time (lower is better)
// 4. Lowest Response Time Standard Deviation (more consistent)
function getRankedLeaderboard(room) {
  const totalQ = room.questions.length || 23;
  const enriched = Object.values(room.players).map((p) => computePlayerStats(p, totalQ));

  return enriched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    const aTime = a.meanTime ?? 999;
    const bTime = b.meanTime ?? 999;
    if (aTime !== bTime) return aTime - bTime;
    const aStd = a.stdDevTime ?? 999;
    const bStd = b.stdDevTime ?? 999;
    return aStd - bStd;
  });
}

function getGroupStatistics(rankings) {
  const scores = rankings.map((r) => r.score);
  const accuracies = rankings.map((r) => r.accuracy);
  const validTimes = rankings.filter((r) => r.meanTime !== null).map((r) => r.meanTime);

  const sortedScores = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sortedScores.length / 2);
  const medianScore =
    sortedScores.length === 0
      ? 0
      : sortedScores.length % 2 !== 0
      ? sortedScores[mid]
      : (sortedScores[mid - 1] + sortedScores[mid]) / 2;

  return {
    meanScore: Number(computeMean(scores).toFixed(1)),
    medianScore: Number(medianScore.toFixed(1)),
    stdDevScore: Number(computeStdDev(scores).toFixed(2)),
    meanAccuracy: Number(computeMean(accuracies).toFixed(1)),
    meanResponseTime: validTimes.length ? Number(computeMean(validTimes).toFixed(2)) : null,
    maxPossiblePoints: 10 * 1 + 8 * 3 + 5 * 5 // 59 points
  };
}

async function fetchScienceQuestions() {
  const allQuestions = [];

  for (const round of ROUNDS) {
    try {
      const url = `https://the-trivia-api.com/v2/questions?limit=${round.count}&categories=science&difficulties=${round.difficulty}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      if (data.length < round.count) throw new Error('Not enough questions');

      data.forEach((item) => {
        allQuestions.push({
          roundName: round.name,
          difficulty: round.difficulty,
          timeLimit: round.time,
          points: round.points,
          question: item.question.text,
          options: shuffle([item.correctAnswer, ...item.incorrectAnswers]),
          correctAnswer: item.correctAnswer
        });
      });
    } catch {
      const fb = shuffle(FALLBACK_QUESTIONS[round.difficulty]).slice(0, round.count);
      fb.forEach((item) => {
        allQuestions.push({
          roundName: round.name,
          difficulty: round.difficulty,
          timeLimit: round.time,
          points: round.points,
          question: item.q,
          options: shuffle([item.correct, ...item.incorrect]),
          correctAnswer: item.correct
        });
      });
    }
  }
  return allQuestions;
}

function generateRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function resetPlayerStats(player) {
  player.score = 0;
  player.correctCount = 0;
  player.responseTimes = [];
  player.answered = false;
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ playerName }) => {
    const roomCode = generateRoomCode();
    const player = {
      id: socket.id,
      name: (playerName || 'Host').trim().slice(0, 16),
      score: 0,
      correctCount: 0,
      responseTimes: [],
      answered: false
    };

    rooms.set(roomCode, {
      code: roomCode,
      hostId: socket.id,
      players: { [socket.id]: player },
      questions: [],
      currentIndex: -1,
      questionStartTime: 0,
      timerInterval: null,
      revealTimeout: null,
      inProgress: false
    });

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.emit('roomJoined', {
      roomCode,
      isHost: true,
      players: getRankedLeaderboard(rooms.get(roomCode))
    });
  });

  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) return socket.emit('errorMsg', 'Room not found. Check the 4-letter code.');
    if (room.inProgress) return socket.emit('errorMsg', 'This quiz is already in progress.');

    room.players[socket.id] = {
      id: socket.id,
      name: (playerName || 'Player').trim().slice(0, 16),
      score: 0,
      correctCount: 0,
      responseTimes: [],
      answered: false
    };

    socket.join(code);
    socket.data.roomCode = code;

    const rankings = getRankedLeaderboard(room);
    socket.emit('roomJoined', { roomCode: code, isHost: false, players: rankings });
    io.to(code).emit('updatePlayers', rankings);
  });

  socket.on('startGame', async () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.inProgress) return;

    clearInterval(room.timerInterval);
    clearTimeout(room.revealTimeout);

    room.inProgress = true;
    io.to(room.code).emit('loadingGame');

    room.questions = await fetchScienceQuestions();
    room.currentIndex = -1;
    Object.values(room.players).forEach(resetPlayerStats);

    nextQuestion(room);
  });

  socket.on('submitAnswer', ({ answer }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.inProgress) return;

    const player = room.players[socket.id];
    const currentQ = room.questions[room.currentIndex];
    if (!player || !currentQ || player.answered) return;

    player.answered = true;
    const elapsedSec = Math.min(
      currentQ.timeLimit,
      Math.max(0.1, (Date.now() - room.questionStartTime) / 1000)
    );
    player.responseTimes.push(elapsedSec);

    const isCorrect = answer === currentQ.correctAnswer;
    if (isCorrect) {
      player.score = Number(player.score) + Number(currentQ.points);
      player.correctCount += 1;
    }

    socket.emit('answerFeedback', {
      isCorrect,
      pointsEarned: isCorrect ? currentQ.points : 0,
      totalScore: player.score,
      responseTime: Number(elapsedSec.toFixed(2))
    });

    // Advance immediately if all active players have answered
    const activePlayers = Object.values(room.players);
    if (activePlayers.length > 0 && activePlayers.every((p) => p.answered)) {
      clearInterval(room.timerInterval);
      revealAnswer(room);
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;

    delete room.players[socket.id];
    const remaining = Object.values(room.players);

    if (remaining.length === 0) {
      clearInterval(room.timerInterval);
      clearTimeout(room.revealTimeout);
      rooms.delete(code);
    } else {
      if (room.hostId === socket.id) {
        room.hostId = remaining[0].id;
        io.to(room.hostId).emit('promotedToHost');
      }
      io.to(code).emit('updatePlayers', getRankedLeaderboard(room));
    }
  });
});

function nextQuestion(room) {
  room.currentIndex++;

  if (room.currentIndex >= room.questions.length) {
    room.inProgress = false;
    const rankings = getRankedLeaderboard(room);
    const groupStats = getGroupStatistics(rankings);
    io.to(room.code).emit('gameOver', { rankings, groupStats });
    return;
  }

  Object.values(room.players).forEach((p) => (p.answered = false));

  const q = room.questions[room.currentIndex];
  room.questionStartTime = Date.now();
  const endTime = room.questionStartTime + q.timeLimit * 1000;

  let roundQuestionNum = room.currentIndex + 1;
  let roundTotal = 10;
  if (q.difficulty === 'medium') {
    roundQuestionNum = room.currentIndex - 10 + 1;
    roundTotal = 8;
  } else if (q.difficulty === 'hard') {
    roundQuestionNum = room.currentIndex - 18 + 1;
    roundTotal = 5;
  }

  io.to(room.code).emit('newQuestion', {
    overallIndex: room.currentIndex + 1,
    overallTotal: room.questions.length,
    roundName: q.roundName,
    difficulty: q.difficulty,
    roundQuestionNum,
    roundTotal,
    points: q.points,
    timeLimit: q.timeLimit,
    question: q.question,
    options: q.options,
    leaderboard: getRankedLeaderboard(room)
  });

  // Drift-free timestamp timer
  let lastBroadcastSec = q.timeLimit;
  room.timerInterval = setInterval(() => {
    const remainingMs = endTime - Date.now();
    const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));

    if (remainingSec !== lastBroadcastSec) {
      lastBroadcastSec = remainingSec;
      io.to(room.code).emit('timerTick', { timeLeft: remainingSec });
    }

    if (remainingMs <= 0) {
      clearInterval(room.timerInterval);
      revealAnswer(room);
    }
  }, 200);
}

function revealAnswer(room) {
  const currentQ = room.questions[room.currentIndex];
  if (!currentQ) return;

  io.to(room.code).emit('revealAnswer', {
    correctAnswer: currentQ.correctAnswer,
    leaderboard: getRankedLeaderboard(room)
  });

  room.revealTimeout = setTimeout(() => {
    if (rooms.has(room.code)) {
      nextQuestion(room);
    }
  }, 3200);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Science Quiz server running on port ${PORT}`);
});