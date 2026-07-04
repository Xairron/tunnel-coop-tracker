import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// === FIREBASE CONFIGURATION ===
const firebaseConfig = {
  apiKey: "AIzaSyCgJdTIzt3XYsbwN4lVMLyPKxYIiB4EoeI",
  authDomain: "tunnel-coop-tracker.firebaseapp.com",
  projectId: "tunnel-coop-tracker",
  storageBucket: "tunnel-coop-tracker.firebasestorage.app",
  messagingSenderId: "1058487861703",
  appId: "1:1058487861703:web:c5f17fe1b3e951413959e2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// === PROFIL UTILISATEUR (Stockage local du navigateur) ===
let currentUser = JSON.parse(localStorage.getItem('coop_user_profile'));
let currentAvatarSeed = 'Guest';

const profileModal = document.getElementById('profile-modal');
const profilePseudoInput = document.getElementById('profile-pseudo-input');
const avatarPreviewImg = document.getElementById('avatar-preview-img');
const userProfileBtn = document.getElementById('user-profile-btn');
const randomAvatarBtn = document.getElementById('random-avatar-btn');

function generateAvatarUrl(seed) {
    return `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(seed)}`;
}

function updateProfileHeader() {
    if (currentUser) {
        userProfileBtn.innerHTML = `
            <img src="${currentUser.avatar}" alt="Avatar">
            <span>${currentUser.pseudo}</span>
        `;
    }
}

userProfileBtn.addEventListener('click', () => {
    if (currentUser) {
        profilePseudoInput.value = currentUser.pseudo;
        currentAvatarSeed = currentUser.avatarSeed || currentUser.pseudo;
    } else {
        currentAvatarSeed = 'Guest';
    }
    updateAvatarPreview();
    profileModal.classList.remove('hidden');
});

profilePseudoInput.addEventListener('input', () => {
    currentAvatarSeed = profilePseudoInput.value.trim() || 'Guest';
    updateAvatarPreview();
});

randomAvatarBtn.addEventListener('click', () => {
    currentAvatarSeed = 'seed_' + Math.random().toString(36).substr(2, 9);
    updateAvatarPreview();
});

function updateAvatarPreview() {
    avatarPreviewImg.src = generateAvatarUrl(currentAvatarSeed);
}

document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const pseudo = profilePseudoInput.value.trim();
    if (pseudo) {
        const oldUser = currentUser;
        
        currentUser = {
            pseudo: pseudo,
            avatarSeed: currentAvatarSeed,
            avatar: generateAvatarUrl(currentAvatarSeed)
        };
        localStorage.setItem('coop_user_profile', JSON.stringify(currentUser));
        updateProfileHeader();
        profileModal.classList.add('hidden');
        
        // Si l'utilisateur modifie son avatar, on met à jour tous ses anciens messages/votes
        if (oldUser && oldUser.pseudo === pseudo) {
            for (let game of games) {
                let changed = false;
                let updatedGame = { ...game };
                
                // Mettre à jour l'auteur unique (migration ancien format)
                if (updatedGame.author && updatedGame.author.pseudo === pseudo && updatedGame.author.avatarSeed !== currentAvatarSeed) {
                    updatedGame.author.avatar = currentUser.avatar;
                    updatedGame.author.avatarSeed = currentUser.avatarSeed;
                    changed = true;
                }
                
                // Mettre à jour les auteurs (nouveau format tableau)
                if (updatedGame.authors) {
                    updatedGame.authors.forEach(a => {
                        if (a.pseudo === pseudo && a.avatarSeed !== currentAvatarSeed) {
                            a.avatar = currentUser.avatar;
                            a.avatarSeed = currentUser.avatarSeed;
                            changed = true;
                        }
                    });
                }

                // Mettre à jour les upvotes
                if (updatedGame.upvotes) {
                    updatedGame.upvotes.forEach(v => {
                        if (v.pseudo === pseudo && v.avatarSeed !== currentAvatarSeed) {
                            v.avatar = currentUser.avatar;
                            v.avatarSeed = currentUser.avatarSeed;
                            changed = true;
                        }
                    });
                }
                
                // Mettre à jour les downvotes
                if (updatedGame.downvotes) {
                    updatedGame.downvotes.forEach(v => {
                        if (v.pseudo === pseudo && v.avatarSeed !== currentAvatarSeed) {
                            v.avatar = currentUser.avatar;
                            v.avatarSeed = currentUser.avatarSeed;
                            changed = true;
                        }
                    });
                }
                
                if (changed) {
                    const gameRef = doc(db, "games", game.id);
                    try {
                        await updateDoc(gameRef, {
                            author: updatedGame.author || null,
                            authors: updatedGame.authors || null,
                            upvotes: updatedGame.upvotes || [],
                            downvotes: updatedGame.downvotes || []
                        });
                    } catch(e) { console.error(e); }
                }
            }
        }
    }
});

if (!currentUser) {
    currentAvatarSeed = 'Guest';
    updateAvatarPreview();
    profileModal.classList.remove('hidden');
} else {
    updateProfileHeader();
}

let userId = localStorage.getItem('coop_user_id');
if (!userId) {
    userId = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('coop_user_id', userId);
}


// === ÉTATS GLOBAUX ===
let games = []; // Rempli par Firebase
let userVotes = JSON.parse(localStorage.getItem('coop_user_votes')) || {};
let currentSelectedSteamId = null;
let expandedGameIds = new Set(); 

const gamesContainer = document.getElementById('games-container');
const addGameForm = document.getElementById('add-game-form');
const gameNameInput = document.getElementById('game-name');
const autocompleteList = document.getElementById('autocomplete-list');


// === FIREBASE TEMPS RÉEL ===
const gamesCollection = collection(db, "games");

onSnapshot(gamesCollection, (snapshot) => {
    games = [];
    snapshot.forEach((doc) => {
        games.push({ id: doc.id, ...doc.data() });
    });
    renderGames(); // Ré-affiche tout dès que la BDD change !
});


// === AUTO-COMPLETE (CheapShark API) ===
let debounceTimer;
gameNameInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value.trim();
    currentSelectedSteamId = null;
    gameNameInput.classList.remove('linked-steam');
    
    if (query.length < 2) {
        autocompleteList.classList.add('hidden');
        return;
    }

    debounceTimer = setTimeout(async () => {
        try {
            const res = await fetch(`https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(query)}&limit=5`);
            const data = await res.json();
            
            autocompleteList.innerHTML = '';
            if (data.length > 0) {
                autocompleteList.classList.remove('hidden');
                data.forEach(item => {
                    const li = document.createElement('li');
                    li.innerHTML = `<img src="${item.thumb}" alt="thumb"> <span>${item.external}</span>`;
                    li.addEventListener('click', () => {
                        gameNameInput.value = item.external;
                        currentSelectedSteamId = item.steamAppID;
                        autocompleteList.classList.add('hidden');
                        gameNameInput.classList.add('linked-steam');
                    });
                    autocompleteList.appendChild(li);
                });
            } else {
                autocompleteList.classList.add('hidden');
            }
        } catch (err) {
            console.error("Erreur API:", err);
        }
    }, 300);
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrapper')) {
        autocompleteList.classList.add('hidden');
    }
});


// === CALCUL DU DÉCOMPTE TEMPOREL ===
function getCountdownText(dateObj) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(dateObj);
    target.setHours(0, 0, 0, 0);
    
    const diffTime = target - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "Aujourd'hui !";
    if (diffDays === 1) return "Demain";
    if (diffDays < 0) return "Dépassé";
    return `Dans ${diffDays}j`;
}


// === RENDU DES JEUX ===
function renderGames() {
    games.sort((a, b) => new Date(a.date) - new Date(b.date));
    gamesContainer.innerHTML = '';
    
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const nextSessionIndex = games.findIndex(g => {
        const d = new Date(g.date);
        d.setHours(0,0,0,0);
        return d >= now;
    });
    
    games.forEach((game, index) => {
        const myVote = userVotes[game.id];
        const dateObj = new Date(game.date);
        const month = dateObj.toLocaleDateString('fr-FR', { month: 'short' });
        const day = dateObj.getDate().toString().padStart(2, '0');
        const countdownText = getCountdownText(dateObj);
        const isNextSession = (index === nextSessionIndex);

        const igLink = `https://www.instant-gaming.com/fr/rechercher/?q=${encodeURIComponent(game.name)}`;
        let steamLinkHtml = '';
        if (game.steamAppID) {
            steamLinkHtml = `<a href="https://store.steampowered.com/app/${game.steamAppID}" target="_blank" class="store-link steam">🎮 Steam</a>`;
        }

        const noteHtml = game.note ? `<div class="game-note">${game.note}</div>` : '';
        
        // Rendu Multi-auteurs (ou rétro-compatibilité auteur unique)
        const authorsList = game.authors || (game.author ? [game.author] : []);
        let authorsHtml = '';
        if (authorsList.length > 0) {
            const authorNames = authorsList.map(a => a.pseudo).join(', ');
            const firstAvatar = authorsList[0].avatar;
            authorsHtml = `
                <div class="game-author">
                    <img src="${firstAvatar}" alt="Avatar">
                    <span>Proposé par ${authorNames}</span>
                </div>
            `;
        }

        // Roue crantée désormais accessible à tous !
        const editBtnHtml = `<button class="game-actions" onclick="openEditModal('${game.id}', event)" title="Modifier ce jeu">⚙️</button>`;

        const card = document.createElement('div');
        const isExpanded = expandedGameIds.has(game.id) ? 'expanded' : '';
        card.className = `game-card glass-panel ${isNextSession ? 'next-session' : ''} ${isExpanded}`;
        
        let nextSessionBadge = isNextSession ? `<div class="next-session-badge">🔥 Prochaine session</div>` : '';

        const upvotesList = game.upvotes || [];
        const downvotesList = game.downvotes || [];

        const upvotersHtml = upvotesList.map(v => `<div class="voter-item"><img src="${v.avatar}"> <span>${v.pseudo}</span></div>`).join('');
        const downvotersHtml = downvotesList.map(v => `<div class="voter-item"><img src="${v.avatar}"> <span>${v.pseudo}</span></div>`).join('');

        card.innerHTML = `
            ${nextSessionBadge}
            <div class="game-date-badge">
                <div class="month">${month}</div>
                <div class="day">${day}</div>
                <div class="countdown">${countdownText}</div>
            </div>
            <div class="game-info">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <h3>${game.name}</h3>
                    ${editBtnHtml}
                </div>
                ${authorsHtml}
                <div class="game-links">
                    ${steamLinkHtml}
                    <a href="${igLink}" target="_blank" class="store-link ig">🛒 Instant Gaming</a>
                </div>
                ${noteHtml}
            </div>
            <div class="votes-container">
                <div class="vote-block up">
                    <button class="vote-btn up ${myVote === 'up' ? 'active' : ''}" onclick="handleVote('${game.id}', 'up', event)">👍</button>
                    <div class="vote-count">${upvotesList.length}</div>
                </div>
                <div class="vote-block down">
                    <button class="vote-btn down ${myVote === 'down' ? 'active' : ''}" onclick="handleVote('${game.id}', 'down', event)">👎</button>
                    <div class="vote-count">${downvotesList.length}</div>
                </div>
            </div>
            
            <div class="game-voters-details">
                <div class="voters-column">
                    <h4 style="color: var(--upvote)">👍 Votants Pour</h4>
                    <div class="voter-list">
                        ${upvotersHtml || '<span style="color:var(--text-muted);font-size:0.8rem;font-style:italic">Aucun vote</span>'}
                    </div>
                </div>
                <div class="voters-column">
                    <h4 style="color: var(--downvote)">👎 Votants Contre</h4>
                    <div class="voter-list">
                        ${downvotersHtml || '<span style="color:var(--text-muted);font-size:0.8rem;font-style:italic">Aucun vote</span>'}
                    </div>
                </div>
            </div>
        `;
        
        card.addEventListener('click', (e) => {
            if (e.target.closest('.vote-btn') || e.target.closest('a') || e.target.closest('.game-actions')) return;
            card.classList.toggle('expanded');
            
            if (card.classList.contains('expanded')) {
                expandedGameIds.add(game.id);
            } else {
                expandedGameIds.delete(game.id);
            }
        });

        gamesContainer.appendChild(card);
    });
}

// === ÉDITION DE JEU ===
let gameToEditId = null;
const editGameModal = document.getElementById('edit-game-modal');
const editGameDateInput = document.getElementById('edit-game-date');
const editGameNoteInput = document.getElementById('edit-game-note');

window.openEditModal = function(gameId, event) {
    if (event) event.stopPropagation();
    const game = games.find(g => g.id === gameId);
    if (!game) return;
    
    gameToEditId = game.id;
    editGameDateInput.value = game.date;
    editGameNoteInput.value = game.note || '';
    
    editGameModal.classList.remove('hidden');
    
    // Auto-resize de la zone de texte (avec un mini délai pour que le DOM soit prêt)
    setTimeout(() => {
        editGameNoteInput.style.height = 'auto';
        editGameNoteInput.style.height = editGameNoteInput.scrollHeight + 'px';
    }, 10);
}

// Auto-resize dynamique pendant la frappe
editGameNoteInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = this.scrollHeight + 'px';
});

document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    editGameModal.classList.add('hidden');
    gameToEditId = null;
});

document.getElementById('save-edit-btn').addEventListener('click', async () => {
    if (!gameToEditId) return;
    
    const game = games.find(g => g.id === gameToEditId);
    if (!game) return;
    
    const gameRef = doc(db, "games", gameToEditId);
    
    // Ajout du modificateur à la liste des auteurs s'il n'y est pas
    let authorsList = game.authors || (game.author ? [game.author] : []);
    if (currentUser) {
        const isAlreadyAuthor = authorsList.some(a => a.pseudo === currentUser.pseudo);
        if (!isAlreadyAuthor) {
            authorsList.push(currentUser);
        }
    }
    
    await updateDoc(gameRef, {
        date: editGameDateInput.value,
        note: editGameNoteInput.value.trim(),
        authors: authorsList,
        author: null // Suppression douce de l'ancienne clé author pour nettoyage
    });
    
    editGameModal.classList.add('hidden');
    gameToEditId = null;
});

document.getElementById('delete-game-btn').addEventListener('click', async () => {
    if (!gameToEditId) return;
    if (confirm("Voulez-vous vraiment supprimer ce jeu de la liste ?")) {
        expandedGameIds.delete(gameToEditId);
        delete userVotes[gameToEditId];
        localStorage.setItem('coop_user_votes', JSON.stringify(userVotes));
        
        const gameRef = doc(db, "games", gameToEditId);
        await deleteDoc(gameRef);
        
        editGameModal.classList.add('hidden');
        gameToEditId = null;
    }
});


// === VOTES ===
window.handleVote = async function(gameId, voteType, event) {
    if (event) event.stopPropagation();
    
    if (!currentUser) {
        profileModal.classList.remove('hidden');
        return;
    }
    const game = games.find(g => g.id === gameId);
    if (!game) return;
    
    const currentVote = userVotes[gameId];
    
    const upvotesList = game.upvotes || [];
    const downvotesList = game.downvotes || [];
    
    let newUpvotes = upvotesList.filter(v => v.pseudo !== currentUser.pseudo);
    let newDownvotes = downvotesList.filter(v => v.pseudo !== currentUser.pseudo);
    
    if (currentVote === voteType) {
        delete userVotes[gameId];
    } else {
        if (voteType === 'up') newUpvotes.push(currentUser);
        if (voteType === 'down') newDownvotes.push(currentUser);
        userVotes[gameId] = voteType;
    }
    
    localStorage.setItem('coop_user_votes', JSON.stringify(userVotes));
    
    // Sauvegarde Firebase
    const gameRef = doc(db, "games", gameId);
    await updateDoc(gameRef, {
        upvotes: newUpvotes,
        downvotes: newDownvotes
    });
}

// === AJOUT D'UN JEU ===
addGameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) {
        profileModal.classList.remove('hidden');
        return;
    }

    const name = gameNameInput.value.trim();
    const date = document.getElementById('game-date').value;
    const note = document.getElementById('game-note').value.trim();
    
    if (name && date) {
        const submitBtn = addGameForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerText = "Ajout...";

        const newGame = {
            name: name,
            date: date,
            steamAppID: currentSelectedSteamId,
            note: note,
            authors: [currentUser], // Tableau d'auteurs
            upvotes: [],
            downvotes: []
        };
        
        try {
            await addDoc(gamesCollection, newGame);
            
            addGameForm.reset();
            currentSelectedSteamId = null;
            autocompleteList.classList.add('hidden');
            gameNameInput.classList.remove('linked-steam');
        } catch (error) {
            console.error("Erreur lors de l'ajout: ", error);
            alert("Erreur lors de l'ajout du jeu.");
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = "Ajouter à la liste";
        }
    }
});
