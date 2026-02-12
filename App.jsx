import React, { useState, useEffect, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot } from 'firebase/firestore';
import { Timer, Zap, Brain, ShieldAlert, CheckCircle2, XCircle, RotateCcw, Home, Award, ChevronRight, Layers, Trophy, User, Star, Sparkles, Flame, Crown } from 'lucide-react';

// Инициализация Firebase
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'musical-trainer-v4';
const apiKey = ""; 

const RARITY_LEVELS = {
  common: { label: "Частый", color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20", icon: <Star size={12}/>, xp: 5 },
  rare: { label: "Редкий", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", icon: <Sparkles size={12}/>, xp: 15 },
  legendary: { label: "Легендарный", color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20", icon: <Crown size={12}/>, xp: 50 },
  mythical: { label: "Мифический", color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20", icon: <Flame size={12}/>, xp: 150 }
};

const TERMS_DATABASE = [
  { term: "Allegro", translation: "Весело", rarity: "common", lang: "it" },
  { term: "Piano", translation: "Тихо", rarity: "common", lang: "it" },
  { term: "Forte", translation: "Громко", rarity: "common", lang: "it" },
  { term: "Largo", translation: "Широко", rarity: "common", lang: "it" },
  { term: "Presto", translation: "Быстро", rarity: "rare", lang: "it" },
  { term: "Rubato", translation: "Свободно", rarity: "rare", lang: "it" },
  { term: "Sforzando", translation: "Внезапно усиливая", rarity: "rare", lang: "it" },
  { term: "Smorzando", translation: "Угасая", rarity: "legendary", lang: "it" },
  { term: "Incalzando", translation: "Ускоряя и усиливая", rarity: "legendary", lang: "it" },
  { term: "Bisbigliando", translation: "Шепотом", rarity: "mythical", lang: "it" },
  { term: "Klangfarbenmelodie", translation: "Тембровая мелодия", rarity: "mythical", lang: "de" }
];

const App = () => {
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState("Player 1");
  const [view, setView] = useState('menu');
  const [mode, setMode] = useState(null);
  const [filterRarity, setFilterRarity] = useState('all');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);

  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [options, setOptions] = useState([]);
  const [userInput, setUserInput] = useState("");
  const [timeLeft, setTimeLeft] = useState(10);
  const [feedback, setFeedback] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const timerRef = useRef(null);

  const fetchGemini = async (prompt) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    };
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    return JSON.parse(data.candidates[0].content.parts[0].text);
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) { console.error("Auth error", e); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    // RULE 1: Четное количество сегментов (6 сегментов)
    // artifacts/{appId}/users/{uid}/profile/stats
    const userDocRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'stats');
    getDoc(userDocRef).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setHighScore(Number(data.highScore) || 0);
        if (data.name) setUserName(String(data.name));
      }
    });

    const leaderboardRef = collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard');
    const unsubscribe = onSnapshot(leaderboardRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id }));
      setLeaderboard(data.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)).slice(0, 5));
    });
    return () => unsubscribe();
  }, [user]);

  const saveScore = async (newScore) => {
    if (!user) return;
    if (newScore > highScore) {
      setHighScore(newScore);
      // RULE 1: Четное количество сегментов
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'stats'), { highScore: newScore, name: userName }, { merge: true });
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'leaderboard', user.uid), { name: userName, score: newScore }, { merge: true });
    }
  };

  const nextQuestion = useCallback(() => {
    let pool = filterRarity === 'all' ? TERMS_DATABASE : TERMS_DATABASE.filter(t => t.rarity === filterRarity);
    const q = pool[Math.floor(Math.random() * pool.length)];
    setCurrentQuestion(q);
    setUserInput("");
    setFeedback(null);
    setTimeLeft(mode === 'bomber' ? 10 : 30);

    if (mode === 'quiz' || mode === 'bomber') {
      const dist = [...new Set(TERMS_DATABASE.map(t => t.translation))]
        .filter(t => t !== q.translation)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);
      setOptions([q.translation, ...dist].sort(() => 0.5 - Math.random()));
    }
  }, [mode, filterRarity]);

  useEffect(() => {
    if (view === 'game' && !currentQuestion) nextQuestion();
  }, [view, currentQuestion, nextQuestion]);

  useEffect(() => {
    if (mode === 'bomber' && view === 'game' && timeLeft > 0 && !feedback) {
      timerRef.current = setTimeout(() => setTimeLeft(p => p - 1), 1000);
    } else if (timeLeft === 0 && mode === 'bomber' && view === 'game' && !feedback) {
      setFeedback({ isCorrect: false, message: "Время истекло" });
      saveScore(score);
    }
    return () => clearTimeout(timerRef.current);
  }, [timeLeft, mode, feedback, view, score]);

  const handleAnswer = (isCorrect) => {
    const xp = RARITY_LEVELS[currentQuestion.rarity].xp;
    if (isCorrect) {
      const newScore = score + xp;
      setScore(newScore);
      setFeedback({ isCorrect: true, message: `Верно! +${xp} XP` });
      saveScore(newScore);
    } else {
      setFeedback({ isCorrect: false, message: `Ошибка. Верно: ${currentQuestion.translation}` });
    }
  };

  const checkHardModeAI = async () => {
    if (!userInput) return;
    setIsLoading(true);
    try {
      const res = await fetchGemini(`Проверь ответ "${userInput}" для термина "${currentQuestion.term}". Редкость: ${currentQuestion.rarity}. Верни JSON { "correct": boolean, "explanation": string }`);
      handleAnswer(res.correct);
    } catch (e) {
      handleAnswer(userInput.toLowerCase() === currentQuestion.translation.toLowerCase());
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 p-4 flex flex-col items-center select-none overflow-x-hidden">
      <div className="w-full max-w-xl flex justify-between items-center py-4 mb-4">
        <button onClick={() => { setView('menu'); setMode(null); setFeedback(null); setCurrentQuestion(null); }} className="p-3 bg-white/5 rounded-2xl border border-white/10">
          <Home size={18} />
        </button>
        <div className="flex gap-2">
          <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 px-4 py-2 rounded-2xl">
            <Trophy size={14} className="text-yellow-500" />
            <span className="font-mono font-bold text-yellow-500">{highScore}</span>
          </div>
          <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 px-4 py-2 rounded-2xl">
            <Award size={14} className="text-blue-400" />
            <span className="font-mono font-bold text-blue-400">{score}</span>
          </div>
        </div>
      </div>

      <div className="w-full max-w-xl">
        {view === 'menu' && (
          <div className="space-y-6">
            <div className="text-center py-6">
              <h1 className="text-5xl font-black italic tracking-tighter text-white uppercase">Lexicon</h1>
              <input 
                type="text" value={userName} onChange={(e) => {
                  const val = e.target.value.slice(0, 15);
                  setUserName(val);
                  if (user) setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'stats'), { name: val }, { merge: true });
                }}
                className="bg-transparent border-b border-white/10 text-center mt-4 outline-none focus:border-white transition-colors py-1 text-xs font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ModeBtn title="Quiz" icon={<Brain/>} onClick={() => { setMode('quiz'); setView('rarity'); setScore(0); }} />
              <ModeBtn title="Bomber" icon={<Zap/>} onClick={() => { setMode('bomber'); setView('rarity'); setScore(0); }} />
              <ModeBtn title="Hard" icon={<ShieldAlert/>} onClick={() => { setMode('hard'); setView('rarity'); setScore(0); }} />
              <ModeBtn title="Matching" icon={<Layers/>} onClick={() => { setMode('matching'); setView('rarity'); setScore(0); }} />
            </div>
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-4">Elite Masters</h3>
              <div className="space-y-2">
                {leaderboard.map((e, i) => (
                  <div key={e.uid} className={`flex justify-between p-3 rounded-xl border ${e.uid === user?.uid ? 'border-blue-500/50 bg-blue-500/10' : 'border-white/5'}`}>
                    <span className="text-sm font-bold">{i+1}. {e.name || "Anon"}</span>
                    <span className="font-mono text-yellow-500 font-bold">{e.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {view === 'rarity' && (
          <div className="space-y-3">
             <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 px-2 mb-4">Выберите сложность</h2>
             <button onClick={() => { setFilterRarity('all'); setView('game'); }} className="w-full p-6 bg-white/5 border border-white/10 rounded-3xl font-bold flex justify-between items-center">
              Все уровни <Layers size={18}/>
            </button>
            {Object.entries(RARITY_LEVELS).map(([key, d]) => (
              <button key={key} onClick={() => { setFilterRarity(key); setView('game'); }} className={`w-full p-6 bg-white/5 border ${d.border} rounded-3xl flex justify-between items-center`}>
                <div className="flex items-center gap-3">
                  <span className={d.color}>{d.icon}</span>
                  <span className={`font-bold uppercase tracking-widest text-sm ${d.color}`}>{d.label}</span>
                </div>
                <span className="text-xs font-mono opacity-50">{d.xp} XP</span>
              </button>
            ))}
          </div>
        )}

        {view === 'game' && currentQuestion && (
          <div className="space-y-6">
            <div className={`bg-white/5 border-2 ${RARITY_LEVELS[currentQuestion.rarity].border} rounded-[3rem] p-10 relative overflow-hidden`}>
               <div className="flex justify-between items-center mb-12">
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${RARITY_LEVELS[currentQuestion.rarity].border} ${RARITY_LEVELS[currentQuestion.rarity].bg}`}>
                   {RARITY_LEVELS[currentQuestion.rarity].icon}
                   <span className={`text-[10px] font-black uppercase tracking-widest ${RARITY_LEVELS[currentQuestion.rarity].color}`}>
                     {RARITY_LEVELS[currentQuestion.rarity].label}
                   </span>
                </div>
                {mode === 'bomber' && <div className={`text-3xl font-mono font-black ${timeLeft < 4 ? 'text-red-500 animate-pulse' : 'text-slate-600'}`}>{timeLeft}s</div>}
              </div>
              <div className="text-center mb-16">
                 <h2 className="text-6xl font-black text-white tracking-tighter">{currentQuestion.term}</h2>
              </div>
              {feedback ? (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <div className={`p-8 rounded-3xl text-center border ${feedback.isCorrect ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                    <p className="font-bold">{feedback.message}</p>
                  </div>
                  <button onClick={nextQuestion} className="w-full py-5 bg-white text-black font-black rounded-3xl uppercase text-xs tracking-widest">Продолжить</button>
                </div>
              ) : (
                <div className="space-y-3">
                  {mode === 'hard' ? (
                    <div className="space-y-3">
                      <input type="text" value={userInput} onChange={(e) => setUserInput(e.target.value)} className="w-full bg-black border-2 border-white/10 rounded-3xl p-6 text-center text-xl font-bold text-white outline-none focus:border-white" disabled={isLoading} autoFocus />
                      <button onClick={checkHardModeAI} disabled={isLoading || !userInput} className="w-full py-5 bg-blue-600 text-white font-black rounded-3xl uppercase text-xs tracking-widest transition-opacity disabled:opacity-20">{isLoading ? "Анализ..." : "Проверить"}</button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      {options.map((opt, i) => (
                        <button key={i} onClick={() => handleAnswer(opt === currentQuestion.translation)} className="p-5 bg-white/5 border border-white/10 rounded-3xl text-center font-bold hover:bg-white/10 transition-all">{opt}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ModeBtn = ({ title, icon, onClick }) => (
  <button onClick={onClick} className="p-6 bg-white/5 border border-white/10 rounded-[2rem] flex flex-col items-center gap-4 hover:bg-white/10 transition-all active:scale-95 group">
    <div className="p-4 bg-white/5 rounded-2xl border border-white/5 group-hover:scale-110 transition-transform">{icon}</div>
    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</span>
  </button>
);

export default App;

