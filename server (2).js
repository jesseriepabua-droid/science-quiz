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

// Round configuration matching your exact specs
const ROUNDS = [
  { name: 'Easy Round', difficulty: 'easy', count: 10, time: 10, points: 1 },
  { name: 'Average Round', difficulty: 'medium', count: 8, time: 15, points: 3 },
  { name: 'Hard Round', difficulty: 'hard', count: 5, time: 20, points: 5 }
];

// Fallback questions in case the external API rate-limits or goes offline
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
    { q: "What is the name of the theoretical boundary around a black hole beyond which nothing can escape?", correct: "Event Horizon", incorrect: ["Singularity", "Schwarzschild Radius", "Accretion Disk"] },
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

async function fetchScienceQuestions() {
  const allQuestions = [];

  for (const round of ROUNDS) {
    try {
      const url = `https://the-trivia-api.com/v2/questions?limit=${round.count}&categories=science&difficulties=${round.difficulty}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('API error');
      const data = await res.json();

      if (data.length < round.count) throw new Error('Insufficient questions');

      data.forEach((item) => {
        const options = shuffle([item.correctAnswer, ...item.incorrectAnswers]);
        allQuestions.push({
          roundName: round.name,
          difficulty: round.difficulty,
          timeLimit: round.time,
          points: round.points,
          question: item.question.text,
          options,
          correctAnswer: item.correctAnswer
        });
      });
    } catch (err) {
      // Use fallback questions if API fails
      const fb = shuffle(FALLBACK_QUESTIONS[round.difficulty]).slice(0, round.count);
      fb.forEach((item) => {
        const options = shuffle([item.correct, ...item.incorrect]);
        allQuestions.push({
          roundName: round.name,
          difficulty: round.difficulty,
          timeLimit: round.time,
          points: round.points,
          question: item.q,
          options,
          correctAnswer: item.correct
        });
      });
    }
  }
  return allQuestions;
}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getLeaderboard(room) {
  return Object.values(room.players).sort((a, b) => b.score - a.score);
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ playerName }) => {
    const roomCode = generateRoomCode();
    rooms.set(roomCode, {
      code: roomCode,
      hostId: socket.id,
      players: {
        [socket.id]: { id: socket.id, name: playerName || 'Host', score: 0, answered: false }
      },
      questions: [],
      currentIndex: -1,
      timer: null,
      inProgress: false
    });

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.emit('roomJoined', { roomCode, isHost: true, players: getLeaderboard(rooms.get(roomCode)) });
  });

  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) return socket.emit('errorMsg', 'Room not found.');
    if (room.inProgress) return socket.emit('errorMsg', 'Game already in progress.');

    room.players[socket.id] = {
      id: socket.id,
      name: playerName || 'Player',
      score: 0,
      answered: false
    };

    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('roomJoined', { roomCode: code, isHost: false, players: getLeaderboard(room) });
    io.to(code).emit('updatePlayers', getLeaderboard(room));
  });

  socket.on('startGame', async () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.inProgress) return;

    room.inProgress = true;
    io.to(room.code).emit('loadingGame');

    room.questions = await fetchScienceQuestions();
    room.currentIndex = -1;

    Object.values(room.players).forEach((p) => {
      p.score = 0;
      p.answered = false;
    });

    nextQuestion(room);
  });

  socket.on('submitAnswer', ({ answer }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.inProgress) return;

    const player = room.players[socket.id];
    const currentQ = room.questions[room.currentIndex];
    if (!player || !currentQ || player.answered) return;

    player.answered = true;
    const isCorrect = answer === currentQ.correctAnswer;

    if (isCorrect) {
      player.score += currentQ.points;
    }

    socket.emit('answerFeedback', {
      isCorrect,
      pointsEarned: isCorrect ? currentQ.points : 0,
      totalScore: player.score
    });

    // If everyone has answered early, move straight to reveal
    const allAnswered = Object.values(room.players).every((p) => p.answered);
    if (allAnswered) {
      clearInterval(room.timer);
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
      clearInterval(room.timer);
      rooms.delete(code);
    } else {
      if (room.hostId === socket.id) {
        room.hostId = remaining[0].id;
        io.to(room.hostId).emit('promotedToHost');
      }
      io.to(code).emit('updatePlayers', getLeaderboard(room));
    }
  });
});

function nextQuestion(room) {
  room.currentIndex++;

  if (room.currentIndex >= room.questions.length) {
    room.inProgress = false;
    io.to(room.code).emit('gameOver', { rankings: getLeaderboard(room) });
    return;
  }

  Object.values(room.players).forEach((p) => (p.answered = false));

  const q = room.questions[room.currentIndex];
  let timeLeft = q.timeLimit;

  // Calculate question number within the current round
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
    options: q.options
  });

  room.timer = setInterval(() => {
    timeLeft--;
    io.to(room.code).emit('timerTick', { timeLeft });

    if (timeLeft <= 0) {
      clearInterval(room.timer);
      revealAnswer(room);
    }
  }, 1000);
}

function revealAnswer(room) {
  const currentQ = room.questions[room.currentIndex];
  io.to(room.code).emit('revealAnswer', {
    correctAnswer: currentQ.correctAnswer,
    leaderboard: getLeaderboard(room)
  });

  setTimeout(() => {
    if (rooms.has(room.code)) {
      nextQuestion(room);
    }
  }, 3500);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Science Quiz server running on port ${PORT}`);
});