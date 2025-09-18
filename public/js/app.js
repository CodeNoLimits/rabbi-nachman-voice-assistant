lucide.createIcons();

const micButton = document.getElementById('mic-button');
const vocalZone = document.getElementById('vocal-zone');
const loader = document.getElementById('loader');
const responseZone = document.getElementById('response-zone');
const instructionText = document.getElementById('instruction-text');
const responseTitle = document.getElementById('response-title');
const responseText = document.getElementById('response-text');
const sourcesList = document.getElementById('sources-list');
const confidenceBar = document.getElementById('confidence-bar');
const confidenceText = document.getElementById('confidence-text');
const listenButton = document.getElementById('listen-button');
const listenIcon = document.getElementById('listen-icon');
const listenText = document.getElementById('listen-text');
const deepenButton = document.getElementById('deepen-button');
const deepenZone = document.getElementById('deepen-zone');
const deepenContent = document.getElementById('deepen-content');
const historyList = document.getElementById('history-list');
const errorBox = document.getElementById('error-box');
const errorText = document.getElementById('error-text');
const ttsAudio = document.getElementById('tts-audio');

let currentResponseText = "";
let isPlaying = false;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SpeechRecognition) {
    showError("La reconnaissance vocale n'est pas supportée par votre navigateur. Essayez Chrome ou Edge.");
    micButton.disabled = true;
}
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) {
    recognition.lang = 'fr-FR';
    recognition.interimResults = false;
}

// --- UI Control Functions ---
function showLoader(isLoading) {
    loader.classList.toggle('hidden', !isLoading);
    vocalZone.classList.toggle('hidden', isLoading);
}

function showError(message) {
    errorText.textContent = message;
    errorBox.classList.remove('hidden');
}

function hideError() {
    errorBox.classList.add('hidden');
}

function displayResponse(data) {
     responseZone.classList.remove('hidden');
     setTimeout(() => responseZone.classList.remove('opacity-0', '-translate-y-4'), 20);
     instructionText.textContent = "Posez une autre question";
}

function resetUI() {
    hideError();
    micButton.classList.remove('pulsing');
    instructionText.textContent = "Posez votre question en français";
    responseZone.classList.add('hidden', 'opacity-0', '-translate-y-4');
    deepenZone.classList.add('hidden', 'opacity-0', '-translate-y-4');
    micButton.disabled = false;
}

function updateHistory(question) {
    const li = document.createElement('li');
    li.textContent = question;
    li.className = "truncate hover:text-white cursor-pointer transition-colors duration-300";
    li.onclick = () => processQuery(question);
    if (historyList.firstChild) {
        historyList.insertBefore(li, historyList.firstChild);
    } else {
        historyList.appendChild(li);
    }
    if (historyList.children.length > 5) {
        historyList.removeChild(historyList.lastChild);
    }
}

// --- API Call Functions ---
async function fetchWithBackoff(url, options, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                return await response.json();
            } else if (response.status === 429) {
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                console.warn(`Throttled. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        } catch (error) {
            console.error(`Fetch error on attempt ${attempt + 1}:`, error);
        }
        attempt++;
    }
    throw new Error('API request failed after multiple retries.');
}

async function askServer(question) {
    try {
        const response = await fetchWithBackoff('/api/query/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: question,
                includeAudio: false
            }),
        });

        return response;
    } catch (error) {
        console.error('Server API error:', error);
        throw new Error(`Impossible de contacter le serveur: ${error.message}`);
    }
}

// --- Main Logic ---
async function processQuery(query) {
    if (!query) return;
    resetUI();
    showLoader(true);
    updateHistory(query);

    try {
        const result = await askServer(query);

        responseTitle.textContent = query;
        responseText.innerHTML = result.answer || "Aucune réponse disponible.";
        currentResponseText = result.answer || "";

        sourcesList.innerHTML = '';
        if (result.citations && result.citations.length > 0) {
            result.citations.forEach(citation => {
                const div = document.createElement('div');
                div.className = "flex items-center text-sm text-green-400";
                div.innerHTML = `<i data-lucide="check-circle-2" class="w-4 h-4 mr-2 flex-shrink-0"></i><span>${citation.reference}</span>`;
                sourcesList.appendChild(div);
            });
        } else {
            sourcesList.innerHTML = `<p class="text-sm text-gray-400">Aucune citation trouvée.</p>`;
        }
        lucide.createIcons();

        const confidence = result.confidence || 85;
        confidenceBar.style.width = `${confidence}%`;
        confidenceText.textContent = `${confidence}%`;

        displayResponse();
    } catch (error) {
        console.error(error);
        showError("Désolé, une erreur est survenue. Veuillez réessayer.");
    } finally {
        showLoader(false);
    }
}

// --- Event Listeners ---
if (recognition) {
    micButton.addEventListener('click', () => {
        if (micButton.classList.contains('pulsing')) {
            recognition.stop();
        } else {
            resetUI();
            micButton.classList.add('pulsing');
            instructionText.textContent = "Écoute en cours... Parlez maintenant.";
            recognition.start();
        }
    });

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        instructionText.textContent = `Vous avez dit : "${transcript}"`;
        processQuery(transcript);
    };

    recognition.onend = () => {
        micButton.classList.remove('pulsing');
        instructionText.textContent = "Posez votre question en français";
    };

    recognition.onerror = (event) => {
        showError(`Erreur de reconnaissance: ${event.error}`);
    };
}

listenButton.addEventListener('click', async () => {
    if (isPlaying) {
        ttsAudio.pause();
        return;
    }
    const originalText = listenText.textContent;
    const originalIcon = listenIcon.outerHTML;

    listenText.textContent = 'Chargement...';
    listenIcon.outerHTML = `<div class="btn-spinner"></div>`;
    listenButton.disabled = true;

    try {
        // Simple TTS using browser API for now
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(currentResponseText);
            utterance.lang = 'fr-FR';
            utterance.rate = 0.9;

            speechSynthesis.speak(utterance);
            isPlaying = true;
            listenText.textContent = 'En cours...';

            utterance.onend = () => {
                isPlaying = false;
                listenText.textContent = originalText;
                listenIcon.outerHTML = originalIcon;
                lucide.createIcons();
            };
        } else {
            throw new Error("Synthèse vocale non supportée");
        }

    } catch (error) {
        console.error(error);
        showError("Impossible de générer l'audio.");
        listenText.textContent = originalText;
        listenIcon.outerHTML = originalIcon;
        lucide.createIcons();
    } finally {
        listenButton.disabled = false;
    }
});

deepenButton.addEventListener('click', async () => {
     deepenZone.classList.add('hidden', 'opacity-0', '-translate-y-4');
     deepenContent.innerHTML = `<div class="flex justify-center"><div class="loader !w-8 !h-8"></div></div>`;
     deepenZone.classList.remove('hidden');
     setTimeout(() => deepenZone.classList.remove('opacity-0', '-translate-y-4'), 20);

     try {
        // Simulate deeper analysis for now
        await new Promise(resolve => setTimeout(resolve, 2000));
        deepenContent.innerHTML = `
            <p class="mb-2">• Explorer d'autres enseignements liés</p>
            <p class="mb-2">• Méditer sur l'application pratique</p>
            <p>• Chercher des exemples concrets</p>
        `;
     } catch(error) {
        console.error(error);
        deepenContent.innerHTML = `<p class="text-red-300">Impossible de générer des pistes de réflexion.</p>`;
     }
});

// Test with a sample query on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log('Rabbi Nachman Voice Assistant loaded');
});