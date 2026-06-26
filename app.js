// ==========================================
// 1. CONFIGURATION & FIREBASE
// ==========================================
let auth, db, currentUser;
let unregisterStateListener = null;
let currentRiderRideId = null;
let unregisterRiderRideListener = null;
let riderMap = null;

window.addEventListener('DOMContentLoaded', () => {
    initFirebase();
    setTimeout(() => {
        const splash = document.getElementById('splashScreen');
        if (splash && splash.classList.contains('active') && !currentUser) {
            navigateTo('authScreen');
        }
    }, 3000);
});

function initFirebase() {
    const firebaseConfig = {
        apiKey: "AIzaSyDZE8eRkLHJtUjB3Hod0T-Q41A5QRF8g5o",
        authDomain: "rapidsafe-7.firebaseapp.com",
        projectId: "rapidsafe-7",
        storageBucket: "rapidsafe-7.firebasestorage.app",
        messagingSenderId: "1037302964530",
        appId: "1:1037302964530:web:ec17393a88fc66d947772b"
    };
  
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    auth = firebase.auth();
    db = firebase.firestore();

    auth.onAuthStateChanged((user) => {
        if (user) {
            currentUser = user;
            listenToUserVerificationState(user.uid);
        } else {
            currentUser = null;
            if(unregisterStateListener) unregisterStateListener();
            navigateTo('authScreen');
        }
    });
}

// ==========================================================
// 2. ROUTING & STATE MANAGEMENT (WITH MAP RESIZING)
// ==========================================================
function listenToUserVerificationState(uid) {
    if(unregisterStateListener) unregisterStateListener();

    unregisterStateListener = db.collection('users').doc(uid).onSnapshot((doc) => {
        if (!doc.exists || !doc.data().phone) {
            navigateTo('phoneScreen');
        } else {
            const data = doc.data();
            
            // Check if rider has completed onboarding
            if (!data.fullName) {
                navigateTo('riderOnboardingScreen');
                initFCM();
            } else {
                const activeScreen = document.querySelector('.screen.active');
                const currentScreenId = activeScreen ? activeScreen.id : '';
                const setupScreens = ['splashScreen', 'authScreen', 'phoneScreen', 'riderOnboardingScreen'];
                
                if (setupScreens.includes(currentScreenId) || currentScreenId === '') {
                    navigateTo('riderDashboardScreen');
                }
            }
        }
    });
}

function navigateTo(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if(target) target.classList.add('active');

    const navBar = document.getElementById('riderBottomNav');
    const navScreens = ['riderDashboardScreen', 'riderActivityScreen', 'riderProfileScreen', 'safetyScreen', 'referScreen'];

    if (navScreens.includes(screenId)) {
        if(navBar) navBar.style.display = 'flex';
        updateNavHighlight(screenId); // This was crashing because the function below was missing!
    } else {
        if(navBar) navBar.style.display = 'none';
    }

    // Dynamic map initialization and resize triggers per active viewport screen state
    if (screenId === 'riderDashboardScreen') {
        setTimeout(() => {
            initRiderMap();
            if (riderMap) riderMap.resize();
        }, 200);
    }
    if (screenId === 'rideSelectionScreen') {
        setTimeout(() => {
            initSelectionMap();
        }, 200);
    }
    if (screenId === 'activeRiderRideScreen') {
        setTimeout(() => {
            initActiveRideMap();
        }, 200);
    }
      if (screenId === 'searchingDriverScreen') {
        setTimeout(() => { initFindingMap(); }, 200);
    }
    
    if (screenId === 'riderProfileScreen') loadRiderData();
    if (screenId === 'riderActivityScreen') loadRiderHistory();
}

// THE MISSING FUNCTION: Highlights the bottom icons
function updateNavHighlight(activeScreenId) {
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    const navItems = document.querySelectorAll('.nav-item');
    if(navItems.length === 0) return;
    if(activeScreenId.includes('Dashboard')) navItems[0].classList.add('active');
    if(activeScreenId.includes('Activity')) navItems[1].classList.add('active');
    if(activeScreenId.includes('Profile')) navItems[2].classList.add('active');
}

// ==========================================
// 3. AUTHENTICATION & ONBOARDING
// ==========================================
let isSignUpMode = false;

function toggleAuthMode() {
    isSignUpMode = !isSignUpMode;
    document.getElementById('authModeTitle').innerText = isSignUpMode ? "Create Account" : "Welcome Back";
    document.getElementById('authModeSubtitle').innerText = isSignUpMode ? "Register to continue" : "Sign in to book a ride";
    document.getElementById('primaryAuthBtn').innerText = isSignUpMode ? "Sign Up" : "Sign In";
    document.getElementById('authToggleSwitcher').innerText = isSignUpMode ? "Already have an account? Sign in" : "Create a new account";
}

async function executeEmailAuth() {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value.trim();
    if(!email || !password) return showInAppNotification("Error", "Please enter email and password.");
    try {
        if(isSignUpMode) await auth.createUserWithEmailAndPassword(email, password);
        else await auth.signInWithEmailAndPassword(email, password);
    } catch (error) { showInAppNotification("Auth Error", error.message); }
}

async function executeGoogleAuth() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try { await auth.signInWithPopup(provider); } 
    catch (error) { showInAppNotification("Google Login Error", error.message); }
}

async function linkPhoneNumber() {
    let phone = document.getElementById('phoneInput').value.trim();
    if(phone.length < 10) return showInAppNotification("Error", "Enter a valid 10-digit number.");
    if(!phone.startsWith("+91")) phone = "+91" + phone.slice(-10);

    try {
        const phoneCheckRef = db.collection('phone_directory').doc(phone);
        const phoneDoc = await phoneCheckRef.get();

        if (phoneDoc.exists && phoneDoc.data().uid !== currentUser.uid) {
            return showInAppNotification("Error", "This phone number is already linked.");
        }

        const batch = db.batch();
        batch.set(phoneCheckRef, { uid: currentUser.uid, email: currentUser.email });
        
        const userRef = db.collection('users').doc(currentUser.uid);
        batch.set(userRef, { 
            email: currentUser.email, 
            phone: phone,
            role: 'rider', // Instantly assigns RIDER role!
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await batch.commit();
    } catch (error) {
        showInAppNotification("Error saving phone", error.message);
    }
}

async function submitRiderOnboarding() {
    const name = document.getElementById('riderNameInput').value.trim();
    if(!name) return showInAppNotification("Required", "Please enter your full name.");
    
    await db.collection('users').doc(currentUser.uid).set({
        fullName: name,
        onboardedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

function logoutUser() { auth.signOut(); }

// ==========================================================
// GLOBAL STATE EXTENSION FOR MULTI-MAP LIFECYCLE
// ==========================================================
const TOMTOM_KEY = "Gl9xwvuDTrkjooFrsdSDi1Rb89K6cOZh"; 
let selectionMap = null;
let activeRideMap = null;
let cachedRoutePoints = null; // Stores line coordinates for cross-screen map rendering

let currentRideDetails = {
    pickup: { name: "", lat: null, lng: null },
    drop: { name: "", lat: null, lng: null },
    distanceKm: 0,
    durationMin: 0
};

let searchTimeout = null;
let activeSearchField = null;


// ==========================================================
// MAP INITIALIZATION & ROUTE LAYERING SUB-FUNCTIONS
// ==========================================================

function initRiderMap() {
    // If map already exists, just resize it so it doesn't glitch
    if (riderMap) {
        riderMap.resize();
        return; 
    }
    
    // Removed the 'style' line. TomTom will now automatically fetch the safest default map!
    riderMap = tt.map({
        key: TOMTOM_KEY,
        container: 'riderMap',
        center: [77.5946, 12.9716], 
        zoom: 16.5
    });

    riderMap.on('load', () => {
        riderMap.resize();
    });

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            riderMap.flyTo({ center: [lng, lat], zoom: 15 });
            new tt.Marker().setLngLat([lng, lat]).addTo(riderMap);
            fetchRealCurrentAddress(lat, lng);
        });
    }
}

function initSelectionMap() {
    if (selectionMap) {
        selectionMap.resize();
        drawRouteLineOnMap(selectionMap);
        return;
    } 
    
    selectionMap = tt.map({
        key: TOMTOM_KEY,
        container: 'selectionMap',
        center: [77.5946, 12.9716],
        zoom: 13
    });

    // Wait for the map tiles to fully load BEFORE drawing the green route line
    selectionMap.on('load', () => {
        selectionMap.resize();
        drawRouteLineOnMap(selectionMap);
    });
}

function initActiveRideMap() {
    if (activeRideMap) {
        activeRideMap.resize();
        drawRouteLineOnMap(activeRideMap);
        return;
    } 
    
    activeRideMap = tt.map({
        key: TOMTOM_KEY,
        container: 'activeRideMap',
        center: [77.5946, 12.9716],
        zoom: 14
    });

    activeRideMap.on('load', () => {
        activeRideMap.resize();
        drawRouteLineOnMap(activeRideMap);
    });
}

// Universal method to paint the route lines and set viewport bound framing cushions
function drawRouteLineOnMap(mapInstance) {
    if (!mapInstance || !cachedRoutePoints || cachedRoutePoints.length === 0) return;

    // Convert coordinates map array to standard GeoJSON layout coordinates format [lng, lat]
    const geoJsonCoords = cachedRoutePoints.map(p => [p.longitude, p.latitude]);

    if (mapInstance.loaded()) {
        renderVectorRouteLayer(mapInstance, geoJsonCoords);
    } else {
        mapInstance.once('load', () => {
            renderVectorRouteLayer(mapInstance, geoJsonCoords);
        });
    }
}

function renderVectorRouteLayer(mapInstance, coordinates) {
    // Clear any previous line instance tracking to avoid layout collisions
    if (mapInstance.getLayer('route-line')) {
        mapInstance.removeLayer('route-line');
        mapInstance.removeSource('route-source');
    }

    mapInstance.addSource('route-source', {
        'type': 'geojson',
        'data': {
            'type': 'Feature',
            'geometry': {
                'type': 'LineString',
                'coordinates': coordinates
            }
        }
    });

    mapInstance.addLayer({
        'id': 'route-line',
        'type': 'line',
        'source': 'route-source',
        'paint': {
            'line-color': '#10b981', // Emerald green brand accent vector formatting
            'line-width': 6
        },
        'layout': {
            'line-cap': 'round',
            'line-join': 'round'
        }
    });

    // Drop clean markers directly onto the route terminal pins
    new tt.Marker({ color: '#22c55e' }).setLngLat(coordinates[0]).addTo(mapInstance); // Start pin point
    new tt.Marker({ color: '#ef4444' }).setLngLat(coordinates[coordinates.length - 1]).addTo(mapInstance); // Drop pin point

    // Fit camera boundaries nicely around the points matrix line bounding boxes
    const bounds = new tt.LngLatBounds();
    coordinates.forEach(coord => bounds.extend(coord));
    mapInstance.fitBounds(bounds, { padding: 40 });
}

// =============================================================================
// REAL-TIME VEHICLE AVAILABILITY ENGINE
// =============================================================================
 async function fetchAvailableVehicles() {
    const availableTypes = new Set();
    const firestoreInstance = typeof db !== 'undefined' ? db : (typeof firestore !== 'undefined' ? firestore : null);
    
    if (!firestoreInstance) return availableTypes;

    try {
        // FIX: Query the 'drivers' collection for 'online' status
        if (typeof firestoreInstance.collection === 'function') {
            const snapshot = await firestoreInstance.collection('drivers')
                .where('status', '==', 'online')
                .get();
                
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.vehicleType) {
                    availableTypes.add(data.vehicleType.toLowerCase().trim());
                }
            });
        } 
        else if (typeof firebase !== 'undefined' && firebase.firestore) {
            const snapshot = await firebase.firestore().collection('drivers')
                .where('status', '==', 'online')
                .get();
                
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.vehicleType) {
                    availableTypes.add(data.vehicleType.toLowerCase().trim());
                }
            });
        }
    } catch (error) {
        console.error("Firestore availability query failed execution: ", error);
    }
    
    return availableTypes;
}

// =============================================================================
// UPDATED REAL-TIME ROUTING ENGINE
// =============================================================================

async function calculateRealRouteAndFares() {
    if (!currentRideDetails.pickup.lat || !currentRideDetails.drop.lat) return;
    
    const suggestionList = document.getElementById('searchSuggestionsList');
    if (suggestionList) {
        suggestionList.innerHTML = `
            <div style="text-align: center; margin-top: 50px;">
                <div class="pulse-loader" style="width:60px;height:60px;font-size:1.5rem;background:#e0f2fe;margin:0 auto;display:flex;align-items:center;justify-content:center;border-radius:50%;">🗺️</div>
                <p style="margin-top:20px; font-weight:600; color:#0f172a;">Analyzing Live Traffic & Drivers...</p>
            </div>`;
    }

    let liveVehicles = new Set();

    try {
        // 1. Fetch available vehicles safely
        liveVehicles = await fetchAvailableVehicles();

        // 2. Build TomTom route URL safely
        const pLat = currentRideDetails.pickup.lat;
        const pLng = currentRideDetails.pickup.lng;
        const dLat = currentRideDetails.drop.lat;
        const dLng = currentRideDetails.drop.lng;
        
        // Ensure TOMTOM_KEY exists, otherwise fall back to a placeholder string for testing
        const activeKey = typeof TOMTOM_KEY !== 'undefined' ? TOMTOM_KEY : 'YOUR_TOMTOM_KEY';
        
        const url = `https://api.tomtom.com/routing/1/calculateRoute/${pLat},${pLng}:${dLat},${dLng}/json?key=${activeKey}&traffic=true`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.routes && data.routes.length > 0) {
            const summary = data.routes[0].summary;
            currentRideDetails.distanceKm = (summary.lengthInMeters / 1000).toFixed(1); 
            currentRideDetails.durationMin = Math.ceil(summary.travelTimeInSeconds / 60); 
            
            // Check if global cachedRoutePoints array exists before assignment
            if (typeof cachedRoutePoints !== 'undefined') {
                cachedRoutePoints = data.routes[0].legs[0].points;
            }
        } else {
            throw new Error("No routes returned from TomTom");
        }
    } catch (e) {
        console.error("Routing execution failed:", e);
        
        // Safe notification wrapper to prevent 'showInAppNotification is not defined' crashes
        if (typeof showInAppNotification === 'function') {
            showInAppNotification("Error", "Could not calculate active route path.");
        } else {
            alert("Error: Could not calculate active route path. Check your TomTom API configuration.");
        }
        return;
    }

    // Render options with the validated vehicle set
    renderRideOptions(liveVehicles);
}

function renderRideOptions(liveVehicles) {
    const dist = parseFloat(currentRideDetails.distanceKm);
    const totalTime = currentRideDetails.durationMin;

    document.getElementById('routeSummaryDistance').innerHTML = `
        <div style="text-align: left; width: 100%; padding: 0 10px;">
            <h2 style="color: #0f172a; margin: 0; font-size: 1.4rem; font-weight: 800;">Choose a ride</h2>
            <span style="color: #64748b; font-weight: 700; font-size: 0.9rem; display: block; margin-top: 4px;">
                📍 ${dist} km • 🕒 ${totalTime} mins
            </span>
        </div>`;

    const expectedTime = dist * 1.5;
    const trafficDelayMins = Math.max(0, Math.floor(totalTime - expectedTime));
    const waitingCharges = trafficDelayMins * 1.50; 

    const currentHour = new Date().getHours();
    const isNightShift = (currentHour >= 22 || currentHour < 5);
    const nightMult = isNightShift ? 1.5 : 1.0;

    let autoTotal = (36 + (dist > 2 ? (dist - 2) * 18 : 0) + waitingCharges) * nightMult;
    let bikeTotal = ((dist * 14) + (waitingCharges * 0.3)) * nightMult;
    let nonAcMiniTotal = (100 + (dist > 4 ? (dist - 4) * 18 : 0) + 20 + waitingCharges) * nightMult;
    let acMiniTotal = (100 + (dist > 4 ? (dist - 4) * 18 : 0) + 20 + waitingCharges) * nightMult;
    let sedanTotal = (115 + (dist > 4 ? (dist - 4) * 21 : 0) + 20 + waitingCharges) * nightMult;
    let xlCabTotal = (130 + (dist > 4 ? (dist - 4) * 24 : 0) + 30 + waitingCharges) * nightMult;

    const options = [
        { id: 'auto', type: 'Auto', icon: '🛺', fare: Math.round(autoTotal), pax: 3, label: 'Easy Commute' },
        { id: 'bike', type: 'Bike', icon: '🛵', fare: Math.round(bikeTotal), pax: 1, label: 'Fastest in Traffic' },
        { id: 'non-ac mini', type: 'Non-AC Mini', icon: '🚗', fare: Math.round(nonAcMiniTotal), pax: 4, label: 'Budget friendly' },
        { id: 'ac mini', type: 'AC Mini', icon: '❄️', fare: Math.round(acMiniTotal), pax: 4, label: 'Budget + Cool' },
        { id: 'sedan', type: 'Sedan', icon: '🚙', fare: Math.round(sedanTotal), pax: 4, label: 'Premium Commute' },
        { id: 'xl cab', type: 'XL Cab', icon: '🚐', fare: Math.round(xlCabTotal), pax: 6, label: 'Extra Spacious' }
    ];

    const list = document.getElementById('vehicleOptionsList');
    if (!list) return;
    list.innerHTML = '';

    let firstAvailableOption = null;

    options.forEach(opt => {
        const isAvailable = liveVehicles.has(opt.id);

        if (isAvailable && !firstAvailableOption) {
            firstAvailableOption = opt; 
        }

        const lowerBound = Math.round(opt.fare - (opt.fare * 0.02));
        const upperBound = Math.round(opt.fare + (opt.fare * 0.02));
        const cardSafeId = `ride-card-${opt.id.replace(/\s+/g, '-')}`; // Creates clean IDs like 'ride-card-auto'

        // Base styling for cards (unselected state)
        const cardStyle = isAvailable 
            ? `border: 2px solid #f1f5f9; cursor: pointer; transition: all 0.2s ease; background: white;` 
            : `border: 2px solid #f1f5f9; opacity: 0.5; background: #f8fafc; pointer-events: none; filter: grayscale(100%);`;

        const actionText = isAvailable 
            ? `<b style="font-size:1.15rem; color: #0f172a;">₹${lowerBound} - ₹${upperBound}</b>`
            : `<b style="font-size:0.8rem; color: #ef4444;">Currently Not Available</b>`;

        // Change onclick to SELECT instead of BOOK
        const clickAction = isAvailable 
            ? `onclick="selectRideVehicle('${cardSafeId}', '${opt.type}', ${opt.fare}, ${lowerBound}, ${upperBound})"` 
            : '';

        list.innerHTML += `
            <div id="${cardSafeId}" class="trusted-card ride-option-card" style="margin-bottom: 12px; border-radius: 16px; padding: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); ${cardStyle}" ${clickAction}>
                <div style="display:flex; align-items:center; width: 100%;">
                    <div style="font-size: 2.2rem; background:#f1f5f9; border-radius:12px; padding:6px 12px;">
                        ${opt.icon}
                    </div>
                    <div style="flex-grow: 1; padding-left: 14px;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <b style="font-size:1.05rem; color: #0f172a;">${opt.type}</b>
                            <span style="font-size: 0.8rem; color: #64748b; font-weight: 700;">👤 ${opt.pax}</span>
                        </div>
                        <p style="color: #64748b; font-size: 0.8rem; margin-top: 2px; font-weight: 500;">
                            ${isNightShift ? 'Night Rates Apply' : opt.label}
                        </p>
                    </div>
                    <div style="text-align: right;">
                        ${actionText}
                    </div>
                </div>
            </div>`;
    });

    // Sticky lower confirm panel
    if (firstAvailableOption) {
        list.innerHTML += `
            <div style="position: sticky; bottom: 0; background: white; padding-top: 12px; margin-top: 20px; z-index:10; border-top: 1px solid #f1f5f9;">
                <button id="stickyBookBtn" class="btn" style="background: #292929; color: #fcd34d; font-size: 1.1rem; font-weight: 700; padding: 16px; border-radius: 14px; width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.1); transition: all 0.2s;">
                    </button>
            </div>`;

        // Automatically select the first available ride as soon as the screen loads
        setTimeout(() => {
            const firstCardId = `ride-card-${firstAvailableOption.id.replace(/\s+/g, '-')}`;
            const defaultLower = Math.round(firstAvailableOption.fare - (firstAvailableOption.fare * 0.02));
            const defaultUpper = Math.round(firstAvailableOption.fare + (firstAvailableOption.fare * 0.02));
            
            selectRideVehicle(firstCardId, firstAvailableOption.type, firstAvailableOption.fare, defaultLower, defaultUpper);
        }, 50);

    } else {
        list.innerHTML += `
            <div style="position: sticky; bottom: 0; background: white; padding-top: 12px; margin-top: 20px; z-index:10; border-top: 1px solid #f1f5f9;">
                <button class="btn" style="background: #ef4444; color: white; font-size: 1.1rem; font-weight: 700; padding: 16px; border-radius: 14px; width: 100%;" disabled>
                    No Rides Currently Available
                </button>
            </div>`;
    }

    navigateTo('rideSelectionScreen');
}

// TomTom Reverse Geocoding
async function fetchRealCurrentAddress(lat, lng) {
    try {
        const res = await fetch(`https://api.tomtom.com/search/2/reverseGeocode/${lat},${lng}.json?key=${TOMTOM_KEY}`);
        const data = await res.json();
        
        if (data && data.addresses && data.addresses.length > 0) {
            const fullAddress = data.addresses[0].address.freeformAddress;
            currentRideDetails.pickup = { name: fullAddress, lat: lat, lng: lng };
            
            const pickupInput = document.getElementById('pickupSearchInput');
            if(pickupInput && !pickupInput.value) {
                pickupInput.value = fullAddress;
            }
        }
    } catch(e) {
        console.error("Reverse geocode failed", e);
        document.getElementById('pickupSearchInput').value = "Current Location";
    }
}

function openLocationSearch() {
    navigateTo('locationSearchScreen');
    if (currentRideDetails.pickup.name) {
        document.getElementById('pickupSearchInput').value = currentRideDetails.pickup.name;
    }
    document.getElementById('dropSearchInput').focus();
    activeSearchField = 'drop';
}

// ==========================================================
// AUTOCOMPLETE & LOCAL HISTORY ENGINE
// ==========================================================
// 1.5. Restores the search screen when coming back from the Ride Selection map
function returnToSearch() {
    navigateTo('locationSearchScreen');
    
    // Ensure the inputs keep the text you already searched for
    if (currentRideDetails.pickup.name) {
        document.getElementById('pickupSearchInput').value = currentRideDetails.pickup.name;
    }
    if (currentRideDetails.drop.name) {
        document.getElementById('dropSearchInput').value = currentRideDetails.drop.name;
    }
    
    // This is the magic fix: It instantly overwrites the "Analyzing Live Traffic" 
    // loader and brings back your saved history cards!
    showSearchHistory();
}

// 1. New: Resets the search screen when clicking "Back"
function closeLocationSearch() {
    // Clear the drop input field so it's empty next time
    const dropInput = document.getElementById('dropSearchInput');
    if (dropInput) dropInput.value = '';
    
    // Clear the saved drop state
    currentRideDetails.drop = { name: "", lat: null, lng: null };
    
    // Reset the UI back to history cards
    showSearchHistory();
    
    // Go back to the map dashboard
    navigateTo('riderDashboardScreen');
}

// 2. Updated: Automatically load history when screen opens
function openLocationSearch() {
    navigateTo('locationSearchScreen');
    if (currentRideDetails.pickup.name) {
        document.getElementById('pickupSearchInput').value = currentRideDetails.pickup.name;
    }
    document.getElementById('dropSearchInput').focus();
    activeSearchField = 'drop';
    
    // Instantly load the past history cards
    showSearchHistory();
}

// 3. Shows History when inputs are empty
function showSearchHistory() {
    const list = document.getElementById('searchSuggestionsList');
    const history = JSON.parse(localStorage.getItem('ny_search_history')) || [];

    if (history.length === 0) {
        list.innerHTML = '<p class="text-muted" style="text-align: center; margin-top: 30px; font-size: 0.95rem;">Type to search locations in your city</p>';
        return;
    }

    list.innerHTML = '';
    history.forEach(item => {
        const safeMain = item.mainText.replace(/'/g, "\\'");
        const safeSub = item.subText.replace(/'/g, "\\'");
        
        // Pixel-perfect Namma Yatri History Card layout
        list.innerHTML += `
            <div style="margin-bottom: 12px; padding: 12px 15px; background: white; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); cursor: pointer; display: flex; align-items: center; gap: 15px;" onclick="selectLocation('${item.lat}', '${item.lng}', '${safeMain}', '${safeSub}')">
                <div style="font-size: 1.2rem; color: #64748b; background: #f8fafc; width: 42px; height: 42px; min-width: 42px; display: flex; align-items: center; justify-content: center; border-radius: 50%;">🕒</div>
                <div style="width: 100%; overflow: hidden;">
                    <b style="font-size:1.05rem; color: #0f172a; display: block; margin-bottom: 2px; white-space: nowrap; text-overflow: ellipsis;">${item.mainText}</b>
                    <span style="color: #64748b; font-size: 0.85rem; display: block; white-space: nowrap; text-overflow: ellipsis;">${item.subText}</span>
                </div>
            </div>
        `;
    });
}

// 4. Saves selected locations to the device
function saveToHistory(lat, lng, mainText, subText) {
    let history = JSON.parse(localStorage.getItem('ny_search_history')) || [];
    history = history.filter(item => item.mainText !== mainText);
    history.unshift({ lat, lng, mainText, subText });
    if(history.length > 10) history.pop();
    localStorage.setItem('ny_search_history', JSON.stringify(history));
}

// 5. Updated Autocomplete Handler (Swaps seamlessly)
function handleSearchInput(fieldType) {
    activeSearchField = fieldType;
    const query = document.getElementById(`${fieldType}SearchInput`).value;
    const list = document.getElementById('searchSuggestionsList');

    // If they erase their text, instantly bring back the History Cards!
    if (query.length < 3) {
        showSearchHistory(); 
        return;
    }

    // Hide history and show live search spinner
    clearTimeout(searchTimeout);
    list.innerHTML = `
        <div style="text-align: center; margin-top: 30px;">
            <div class="pulse-loader" style="width: 40px; height: 40px; font-size: 1.2rem;">🔍</div>
        </div>`;

    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?key=${TOMTOM_KEY}&countrySet=IN&lat=12.9716&lon=77.5946&radius=50000&limit=5`);
            const data = await res.json();
            
            list.innerHTML = '';
            
            if (!data.results || data.results.length === 0) {
                list.innerHTML = '<p class="text-muted" style="text-align: center; margin-top: 20px;">No results found.</p>';
                return;
            }

            data.results.forEach(place => {
                const mainText = place.poi ? place.poi.name : place.address.streetName || place.address.municipalitySubdivision;
                const subText = place.address.freeformAddress;
                const safeMain = mainText.replace(/'/g, "\\'"); 
                const safeSub = subText.replace(/'/g, "\\'"); 
                
                // Live search results use the Map Pin 📍 instead of the Clock 🕒
                list.innerHTML += `
                    <div style="margin-bottom: 12px; padding: 12px 15px; border-bottom: 1px solid #f1f5f9; cursor: pointer; display: flex; align-items: center; gap: 15px;" onclick="selectLocation('${place.position.lat}', '${place.position.lon}', '${safeMain}', '${safeSub}')">
                        <div style="font-size: 1.2rem; color: #94a3b8; background: #f8fafc; width: 42px; height: 42px; min-width: 42px; display: flex; align-items: center; justify-content: center; border-radius: 50%;">📍</div>
                        <div style="width: 100%; overflow: hidden;">
                            <b style="font-size:1.05rem; color: #0f172a; display: block; margin-bottom: 2px; white-space: nowrap; text-overflow: ellipsis;">${mainText}</b>
                            <span style="color: #64748b; font-size: 0.85rem; display: block; white-space: nowrap; text-overflow: ellipsis;">${subText}</span>
                        </div>
                    </div>
                `;
            });
        } catch (e) {
            list.innerHTML = '<p class="text-muted" style="text-align: center; margin-top: 20px;">Network error.</p>';
        }
    }, 600); 
}

// 6. Updated Select Handler
function selectLocation(lat, lng, mainText, subText) {
    saveToHistory(lat, lng, mainText, subText);

    if(activeSearchField === 'pickup') {
        currentRideDetails.pickup = { lat: parseFloat(lat), lng: parseFloat(lng), name: mainText };
        document.getElementById('pickupSearchInput').value = mainText;
        document.getElementById('dropSearchInput').focus();
        showSearchHistory(); 
        activeSearchField = 'drop';
    } else {
        currentRideDetails.drop = { lat: parseFloat(lat), lng: parseFloat(lng), name: mainText };
        document.getElementById('dropSearchInput').value = mainText;
        calculateRealRouteAndFares();
    }
}

// =============================================================================
// RIDER APP: INITIATE RIDE & START REAL-TIME STREAM
// =============================================================================

async function confirmRideBooking(vehicleType, fare) {
    try {
        let uid = null;
        if (typeof auth !== 'undefined' && auth.currentUser) {
            uid = auth.currentUser.uid;
        } else if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
            uid = firebase.auth().currentUser.uid;
        }
        
        if (!uid) {
            showInAppNotification("Error", "No active login session found.");
            return;
        }

        const firestoreInstance = typeof db !== 'undefined' ? db : null;
        if (!firestoreInstance) return;

        // Generate a random 4-digit OTP
        const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
        
        const userDoc = await firestoreInstance.collection('users').doc(uid).get();
        const realName = userDoc.data().fullName || "Rider";

        const ridePayload = {
            riderUid: uid, // Matches your old rules and driver app queries
            passengerName: realName, 
            driverUid: null, 
            status: 'pending', // lowercase to match your old DB structure
            vehicleType: vehicleType,
            fare: Math.round(fare),
            otp: otpCode,
            distance: parseFloat(currentRideDetails.distanceKm || 0),
            pickupLocation: currentRideDetails.pickup.name || "Current Location",
            dropLocation: currentRideDetails.drop.name || "Destination",
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        const newRideRef = await firestoreInstance.collection('rides').add(ridePayload);
        console.log("Ride requested successfully. ID: ", newRideRef.id);
        
        // Save ID globally so the cancel button works
        currentRiderRideId = newRideRef.id;
        
        // Switch to the searching screen immediately
        navigateTo('searchingDriverScreen'); 
        
        // Start the Live Listener!
        startRiderRideStateListener(currentRiderRideId);

    } catch (error) {
        console.error("Booking error: ", error);
        showInAppNotification("Booking Error", error.message);
    }
}

function cancelRideRequest() {
    if(currentRiderRideId && db) {
        // Tell the database the rider cancelled
        db.collection('rides').doc(currentRiderRideId).update({ status: 'cancelled_by_rider' });
        currentRiderRideId = null;
    }
    if(unregisterRiderRideListener) unregisterRiderRideListener();
    navigateTo('riderDashboardScreen');
}

function startRiderRideStateListener(rideId) {
    if(unregisterRiderRideListener) unregisterRiderRideListener();

    unregisterRiderRideListener = db.collection('rides').doc(rideId).onSnapshot(async (doc) => {
        if (!doc.exists) return;
        const ride = doc.data();

        // 1. Driver Accepts
        if (ride.status === 'accepted') {
            const driverDoc = await db.collection('drivers').doc(ride.driverUid).get();
            const driverData = driverDoc.data() || {};
            
            // Setup Headings
            document.getElementById('rideStatusTextRider').innerText = "Driver is on the way!";
            document.getElementById('riderOtpDisplay').innerText = `OTP ${ride.otp}`;
            document.getElementById('riderOtpDisplay').style.display = 'block';
            
            // FIX: Aggressively pull name (checks fullName or name)
            const driverName = driverData.fullName || driverData.name || "Driver Partner";
            document.getElementById('assignedDriverName').innerText = driverName;
            document.getElementById('finalRiderFareEstimate').innerText = `₹${ride.fare}`;

            // Pull real driver photo
            const photoEl = document.getElementById('assignedDriverPhoto');
            if (photoEl) {
                const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(driverName)}&background=e2e8f0&color=0f172a&bold=true`;
                photoEl.src = (driverData.vaultData && driverData.vaultData.profilePhoto) ? driverData.vaultData.profilePhoto : fallbackAvatar;
            }

            // Smart Vehicle Recognition
            let vIcon = '🛺'; let vPax = 3; let vModel = 'AUTO';
            const vTypeStr = ride.vehicleType ? ride.vehicleType.toLowerCase() : 'auto';
            if (vTypeStr.includes('bike')) { vIcon = '🛵'; vPax = 1; vModel = 'MOTO'; } 
            else if (vTypeStr.includes('mini') || vTypeStr.includes('sedan') || vTypeStr.includes('cab')) { vIcon = '🚗'; vPax = 4; vModel = 'CAB'; }

            document.getElementById('assignedVehicleIcon').innerText = vIcon;
            
            // FIX: Pull Real Vehicle Model (If blank, fall back to "CAB" or "AUTO")
            document.getElementById('assignedVehicleModel').innerText = driverData.vehicleModel || (driverData.vehicleType ? driverData.vehicleType.toUpperCase() : vModel);
            
            // Pull License Plate
            document.getElementById('assignedVehiclePlate').innerText = driverData.vehicleNumber || "KA 01 --"; 
            
            // Check both 'vehicleNumber' and 'vehiclePlate' just in case
            document.getElementById('assignedVehiclePlate').innerText = driverData.vehicleNumber || driverData.vehiclePlate || "KA 01 --"; 
            
            // Calculate Rating
            let realAvgRating = "5.0"; 
            if (driverData.totalRatings && driverData.totalRatingPoints) {
                realAvgRating = (driverData.totalRatingPoints / driverData.totalRatings).toFixed(1);
            }
            
            document.getElementById('assignedVehicleInfo').innerText = `${ride.vehicleType} | ★ ${realAvgRating} | 👤 ${vPax}`;
            
            navigateTo('activeRiderRideScreen');
        } 
      
        // 2. Driver Arrives at Pickup
        else if (ride.status === 'arrived') {
            document.getElementById('rideStatusTextRider').innerText = "Driver has arrived!";
            document.getElementById('riderOtpDisplay').style.background = '#fcd34d'; // Pulse yellow to highlight OTP
            showInAppNotification("Driver Arrived", "Your ride is here. Please share the OTP.");
        }
        
        // 3. Driver enters OTP and starts the trip
        else if (ride.status === 'in_progress') {
            document.getElementById('rideStatusTextRider').innerText = "Heading to destination";
            document.getElementById('riderOtpDisplay').style.display = 'none'; // Hide OTP
        }
        
                // 4. Driver reaches destination and completes the trip
        else if (ride.status === 'completed') {
            document.getElementById('finalRiderFare').innerText = `₹${ride.fare}`;
            
            // Carry over the Driver's Name and Photo to the final rating screen
            const driverNameEl = document.getElementById('assignedDriverName');
            const driverPhotoEl = document.getElementById('assignedDriverPhoto');
            
            if (driverNameEl && document.getElementById('ratingDriverName')) {
                document.getElementById('ratingDriverName').innerText = driverNameEl.innerText;
            }
            if (driverPhotoEl && document.getElementById('ratingDriverPhoto')) {
                document.getElementById('ratingDriverPhoto').src = driverPhotoEl.src;
            }
            
            // Save the driver's ID globally so the rating screen knows who to review
            currentDriverToRate = ride.driverUid; 
            
            // Reset stars for the new screen
            setRatingUI(0);
            
            currentRiderRideId = null;
            if(unregisterRiderRideListener) unregisterRiderRideListener();
            navigateTo('riderRatingScreen');
        }

        
        // 5. Driver cancels
        else if (ride.status === 'cancelled_by_driver') {
            showInAppNotification("Ride Cancelled", "The driver cancelled the request.");
            currentRiderRideId = null;
            if(unregisterRiderRideListener) unregisterRiderRideListener();
            navigateTo('riderDashboardScreen');
        }
    });
}

// ==========================================
// RIDER DATA & UTILS
// ==========================================
async function loadRiderData() {
    if (!currentUser) return;
    
    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        let fullName = "Rider";
        let email = currentUser.email || "";

        if(doc.exists) {
            const data = doc.data();
            if (data.fullName) fullName = data.fullName;
            if (data.email) email = data.email;
        }

        // Set Text Fields
        const nameDisplay = document.getElementById('riderProfileNameDisplay');
        const emailDisplay = document.getElementById('riderProfileEmailDisplay');
        
        if(nameDisplay) nameDisplay.innerText = fullName;
        if(emailDisplay) emailDisplay.innerText = email || (currentUser.phoneNumber || "No contact info");

        // Set Dynamic Avatar Letter (First letter of name)
        const letterDisplay = document.getElementById('profileAvatarLetter');
        if (letterDisplay) {
            letterDisplay.innerText = fullName.charAt(0).toUpperCase();
        }

    } catch (error) {
        console.error("Error loading profile data:", error);
    }
}

// ==========================================================
// CLIENT-SIDE SORTED RIDE HISTORY ENGINE (NO INDEX REQUIRED)
// ==========================================================
async function loadRiderHistory() {
    if (!currentUser) return;
    
    const list = document.getElementById('riderHistoryList');
    if (!list) return;
    
    // Show a clean placeholder while sync executes
    list.innerHTML = "<p class='text-muted' style='text-align:center; padding:20px; font-weight:600;'>Syncing trips...</p>";
    
    try {
        // Simple single-field query to completely bypass index limitations
        const snapshot = await db.collection('rides')
            .where('riderUid', '==', currentUser.uid)
            .get();

        list.innerHTML = "";
        
        if (snapshot.empty) {
            list.innerHTML = "<p class='text-muted' style='text-align:center; padding:20px;'>No completed trips yet.</p>";
            return;
        }

        const completedTrips = [];
        
        // 1. Safe parsing filter layer
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.status === 'completed') {
                completedTrips.push(data);
            }
        });

        if (completedTrips.length === 0) {
            list.innerHTML = "<p class='text-muted' style='text-align:center; padding:20px;'>No completed trips yet.</p>";
            return;
        }

        // 2. Safe local sorting fallback layer (Handles both Timestamps and String dates)
        completedTrips.sort((a, b) => {
            const timeA = a.timestamp ? (a.timestamp.toDate ? a.timestamp.toDate() : new Date(a.timestamp)) : new Date(0);
            const timeB = b.timestamp ? (b.timestamp.toDate ? b.timestamp.toDate() : new Date(b.timestamp)) : new Date(0);
            return timeB - timeA; // Descending order (newest first)
        });

        // 3. Premium Render block matching Namma Yatri aesthetics
        completedTrips.slice(0, 10).forEach(ride => {
            let displayDate = "Recent Trip";
            
            if (ride.timestamp) {
                const dateObj = ride.timestamp.toDate ? ride.timestamp.toDate() : new Date(ride.timestamp);
                displayDate = dateObj.toLocaleDateString([], { 
                    month: 'short', 
                    day: 'numeric', 
                    year: 'numeric' 
                });
            }

            list.innerHTML += `
                <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.01);">
                    <div style="overflow: hidden; max-width: 70%;">
                        <strong style="color:#0f172a; font-size: 1.05rem; display: block; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">
                            ${ride.dropLocation || 'Completed Trip'}
                        </strong>
                        <p style="font-size:0.8rem; color:#64748b; margin-top:5px; font-weight:600;">
                            ${displayDate}
                        </p>
                    </div>
                    <div style="font-weight: 800; color: #10b981; font-size: 1.2rem; background: #f0fdf4; padding: 6px 12px; border-radius: 10px;">
                        ₹${ride.fare || 0}
                    </div>
                </div>`;
        });

    } catch (error) {
        console.error("History engine failure diagnostics:", error);
        list.innerHTML = "<p class='text-muted' style='text-align:center; padding:20px; color:#ef4444;'>Error synchronizing ride logs.</p>";
    }
}

function showInAppNotification(title, message) {
    document.getElementById('toastTitle').innerText = title;
    document.getElementById('toastBody').innerText = message;
    const toast = document.getElementById('inAppToast');
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 4000);
}

function closeToast() { document.getElementById('inAppToast').classList.remove('show'); }

// =============================================================================
// RIDER APP: REAL-TIME STATE ENGINE FOR LIFECYCLE SYNC
// =============================================================================

let rideSubscriptionDeactivate = null; // Holds active unsubscribe token

function listenToLiveRideStatus(rideId) {
    // If a previous collection stream is active, close it out to avoid memory leaks
    if (typeof rideSubscriptionDeactivate === 'function') {
        rideSubscriptionDeactivate();
    }

    const firestoreInstance = typeof db !== 'undefined' ? db : (typeof firestore !== 'undefined' ? firestore : null);
    const databaseTarget = typeof firestoreInstance.collection === 'function' ? firestoreInstance : firebase.firestore();

    console.log(`Establishing live data link channel for ride: ${rideId}`);

    rideSubscriptionDeactivate = databaseTarget.collection('rides').doc(rideId).onSnapshot((doc) => {
        if (!doc.exists) {
            console.warn("The requested ride document data stream was removed.");
            return;
        }

        const rideData = doc.data();
        console.log("Real-time State Update Intercepted:", rideData.status, rideData);

        switch (rideData.status) {
            case 'REQUESTED':
                // Passenger stays on the clean searching spinner screen
                navigateTo('findingDriverScreen');
                break;

            case 'ACCEPTED':
                // Driver has clicked accept. Show driver name, plate, and tracking data
                updateDriverMatchedUI(rideData);
                navigateTo('driverMatchedScreen');
                break;

            case 'ARRIVED':
                // Driver has arrived physically at the pickup point location
                updateRiderArrivalUI(rideData);
                break;

            case 'STARTED':
                // Driver entered OTP code and trip began. Move to the live routing map
                updateLiveTripUI(rideData);
                navigateTo('onRideScreen');
                break;

            case 'COMPLETED':
                // Trip ended gracefully by driver. Show final invoice summary
                showFinalReceiptUI(rideData);
                navigateTo('receiptScreen');
                
                // Break active listener link to prevent redundant loop triggers
                if (typeof rideSubscriptionDeactivate === 'function') {
                    rideSubscriptionDeactivate();
                    rideSubscriptionDeactivate = null;
                }
                break;

            case 'CANCELLED':
                alert("This ride booking request was cancelled.");
                navigateTo('riderDashboardScreen');
                if (typeof rideSubscriptionDeactivate === 'function') {
                    rideSubscriptionDeactivate();
                    rideSubscriptionDeactivate = null;
                }
                break;
        }
    }, (error) => {
        console.error("Live status engine listener failed: ", error);
    });
}
// =============================================================================
// RIDE SELECTION UI HANDLER
// =============================================================================

function selectRideVehicle(cardId, type, fare, minFare, maxFare) {
    // 1. Reset all cards back to the default unselected state
    document.querySelectorAll('.ride-option-card').forEach(card => {
        card.style.border = '2px solid #f1f5f9';
        card.style.background = 'white';
    });

    // 2. Highlight the newly selected card with the signature Yellow border
    const selectedCard = document.getElementById(cardId);
    if (selectedCard) {
        selectedCard.style.border = '2px solid #fbbf24'; // Amber border
        selectedCard.style.background = '#fffbeb'; // Faint yellow tint background
    }

    // 3. Update the sticky bottom button text and attach the final booking command
    const bookBtn = document.getElementById('stickyBookBtn');
       // Inside selectRideVehicle function...
    if (bookBtn) {
        bookBtn.innerHTML = `Book ${type} @ ₹${minFare} - ₹${maxFare}`;
        bookBtn.onclick = () => {
            // Setup the finding screen UI with the exact prices
            setupFindingScreen(type, minFare, maxFare); 
            // Call the database function
            confirmRideBooking(type, maxFare); 
        };
    }
  }
// =============================================================================
// NAMMA YATRI FINDING SCREEN LOGIC (TIPS & RADIUS EXPANSION)
// =============================================================================

let findingMap = null;
let activeSearchRadiusInterval = null;
let currentRideBaseFare = { min: 0, max: 0, tip: 0, type: '' };

function initFindingMap() {
    if (findingMap) {
        findingMap.resize();
        drawRouteLineOnMap(findingMap);
        return;
    } 
    findingMap = tt.map({
        key: TOMTOM_KEY,
        container: 'findingMap',
        center: [77.5946, 12.9716],
        zoom: 14
    });
    findingMap.on('load', () => {
        findingMap.resize();
        drawRouteLineOnMap(findingMap);
    });
}

// Called right before navigating to the finding screen to setup the initial UI
function setupFindingScreen(vehicleType, minFare, maxFare) {
    currentRideBaseFare = { min: minFare, max: maxFare, tip: 0, type: vehicleType };
    
    // Reset tip pills
    document.querySelectorAll('.ny-tip-pill').forEach(btn => btn.classList.remove('active'));
    
    updateFindingFareUI();
    startRadiusExpansionLogic();
}

function updateFindingFareUI() {
    const finalMin = currentRideBaseFare.min + currentRideBaseFare.tip;
    const finalMax = currentRideBaseFare.max + currentRideBaseFare.tip;
    
    document.getElementById('findingLiveFare').innerText = `₹${finalMin} - ₹${finalMax}`;
    
    const boostBtn = document.getElementById('boostSearchBtn');
    if (currentRideBaseFare.tip > 0) {
        boostBtn.innerText = `Boost Search @ ₹${finalMin}-₹${finalMax}`;
        boostBtn.style.background = '#292929'; // Turn dark and clickable
        boostBtn.style.pointerEvents = 'auto';
    } else {
        boostBtn.innerText = 'Awaiting Response...';
        boostBtn.style.background = '#94a3b8'; // Grey out
        boostBtn.style.pointerEvents = 'none';
    }
}

function addTipAmount(amount, buttonElement) {
    // Highlight the selected pill
    document.querySelectorAll('.ny-tip-pill').forEach(btn => btn.classList.remove('active'));
    buttonElement.classList.add('active');
    
    // Update local state and UI
    currentRideBaseFare.tip = amount;
    updateFindingFareUI();
}

async function boostSearch() {
    if (!currentRiderRideId || !db) return;
    
    const finalMax = currentRideBaseFare.max + currentRideBaseFare.tip;
    
    // Instantly update Firebase with the new tipped fare so drivers see it flash!
    await db.collection('rides').doc(currentRiderRideId).update({
        fare: finalMax,
        tipAdded: currentRideBaseFare.tip
    });
    
    document.getElementById('findingStatusTitle').innerText = "Broadcasting boosted search! ⚡";
    showInAppNotification("Boosted!", `Added ₹${currentRideBaseFare.tip} tip to attract drivers faster.`);
}

// The Magic Namma Yatri Expansion Algorithm
function startRadiusExpansionLogic() {
    if (activeSearchRadiusInterval) clearInterval(activeSearchRadiusInterval);
    
    let currentRadius = 2; // Start at 2km
    document.getElementById('findingRadiusText').innerText = `Broadcasting to drivers within ${currentRadius}km...`;
    
    // Update Firebase so the database knows our current search radius
    if(currentRiderRideId) {
        db.collection('rides').doc(currentRiderRideId).update({ searchRadius: currentRadius });
    }

    // Every 15 seconds, expand the radar by 3km
    activeSearchRadiusInterval = setInterval(() => {
        currentRadius += 3;
        
        if (currentRadius > 15) {
            clearInterval(activeSearchRadiusInterval);
            document.getElementById('findingRadiusText').innerText = "Broadcasting to all city drivers...";
        } else {
            document.getElementById('findingRadiusText').innerText = `Expanding search to ${currentRadius}km...`;
            document.getElementById('findingStatusTitle').innerText = "Expanding search area";
        }

        // Push new radius to Firebase so drivers further away can now "see" this ride
        if(currentRiderRideId) {
            db.collection('rides').doc(currentRiderRideId).update({ searchRadius: currentRadius });
        }
    }, 15000); 
}
// =============================================================================
// CANCELLATION & RATING LOGIC
// =============================================================================

let selectedCancelReason = null;
let currentDriverToRate = null;
let currentSelectedRating = 0;

// 1. Opens the overlay instead of instantly cancelling
function cancelRideRequest() {
    document.getElementById('cancelReasonOverlay').style.display = 'flex';
    // Reset modal state
    selectedCancelReason = null;
    document.querySelectorAll('.cancel-reason-btn').forEach(b => b.classList.remove('selected'));
    const btn = document.getElementById('confirmCancelBtn');
    btn.style.background = '#cbd5e1';
    btn.style.pointerEvents = 'none';
}

function closeCancelModal() {
    document.getElementById('cancelReasonOverlay').style.display = 'none';
}

function selectCancelReason(btnElement, reasonText) {
    document.querySelectorAll('.cancel-reason-btn').forEach(b => b.classList.remove('selected'));
    btnElement.classList.add('selected');
    selectedCancelReason = reasonText;
    
    // Activate the submit button
    const submitBtn = document.getElementById('confirmCancelBtn');
    submitBtn.style.background = '#0f172a'; // Turn dark and clickable
    submitBtn.style.pointerEvents = 'auto';
}

// Actually processes the cancellation to Firebase
async function processCancellation() {
    if(currentRiderRideId && db) {
        await db.collection('rides').doc(currentRiderRideId).update({ 
            status: 'cancelled_by_rider',
            cancelReason: selectedCancelReason 
        });
        currentRiderRideId = null;
    }
    
    closeCancelModal();
    if(unregisterRiderRideListener) unregisterRiderRideListener();
    navigateTo('riderDashboardScreen');
    showInAppNotification("Cancelled", "Ride request cancelled.");
}

// 2. Interactive Rating UI
function setRatingUI(stars) {
    currentSelectedRating = stars;
    const starElements = document.getElementById('ratingStarsContainer').children;
    const feedbackText = document.getElementById('ratingFeedbackText');
    
    // Dynamic text array matching star count (0 to 5)
    const feedbackPhrases = ["Tap a star to rate", "Terrible 😞", "Bad 😕", "Okay 😐", "Good 🙂", "Excellent! 🤩"];
    
    for (let i = 0; i < starElements.length; i++) {
        if (i < stars) {
            starElements[i].style.color = '#fbbf24'; // Gold
            starElements[i].style.transform = 'scale(1.15)'; // Make it pop larger
        } else {
            starElements[i].style.color = '#e2e8f0'; // Grey
            starElements[i].style.transform = 'scale(1)'; // Normal size
        }
    }
    
    // Update the text label
    if (feedbackText) {
        feedbackText.innerText = feedbackPhrases[stars];
        feedbackText.style.color = stars <= 2 ? '#ef4444' : (stars === 3 ? '#f59e0b' : '#10b981'); // Changes text color based on mood
    }
}

// Submits the rating to the Driver's profile in Firestore
async function submitRideRating() {
    // If they didn't select a rating, just take them home
    if (!currentDriverToRate || currentSelectedRating === 0) {
        navigateTo('riderDashboardScreen');
        return;
    }
    
    try {
        const driverRef = db.collection('users').doc(currentDriverToRate);
        
        // Securely read the driver's current rating data and add the new rating
        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(driverRef);
            if (!doc.exists) return;
            
            const data = doc.data();
            const newTotalRatings = (data.totalRatings || 0) + 1;
            const newTotalPoints = (data.totalRatingPoints || 0) + currentSelectedRating;
            
            transaction.update(driverRef, {
                totalRatings: newTotalRatings,
                totalRatingPoints: newTotalPoints
            });
        });
        
        showInAppNotification("Thank you!", "Your feedback helps us improve.");
    } catch (e) {
        console.error("Failed to submit rating: ", e);
    }
    
    // Reset state and go home
    currentDriverToRate = null;
    currentSelectedRating = 0;
    setRatingUI(0); // Reset UI stars
    navigateTo('riderDashboardScreen');
}
// =============================================================================
// BACKGROUND FCM PUSH NOTIFICATIONS
// =============================================================================

let messaging = null;

function initFCM() {
    try {
        if (typeof firebase !== 'undefined' && firebase.messaging) {
            messaging = firebase.messaging();
            
            // Request push permission from the phone/browser
            messaging.requestPermission()
                .then(() => messaging.getToken())
                .then((token) => {
                    if (token && currentUser && db) {
                        console.log("FCM Token Generated:", token);
                        // Save token to user profile so the Driver App can send pushes to this phone
                        db.collection('users').doc(currentUser.uid).update({ fcmToken: token });
                    }
                })
                .catch(err => console.log("Push notifications blocked or unsupported.", err));

            // If a notification arrives while the app is actively open, show the in-app toast
            messaging.onMessage((payload) => {
                const title = payload.notification?.title || "Update";
                const body = payload.notification?.body || "New message received.";
                showInAppNotification(title, body);
            });
        }
    } catch (e) {
        console.warn("FCM not fully configured in this environment.", e);
    }
}

// =============================================================================
// REAL-TIME EMERGENCY SOS SYSTEM
// =============================================================================

function triggerSOS() {
    // 1. Open the Overlay
    const sosOverlay = document.getElementById('sosEmergencyOverlay');
    if (sosOverlay) sosOverlay.style.display = 'flex';

    // 2. Fetch the live data currently on the screen
    const driverName = document.getElementById('assignedDriverName') ? document.getElementById('assignedDriverName').innerText : "Unknown Driver";
    const vehiclePlate = document.getElementById('assignedVehiclePlate') ? document.getElementById('assignedVehiclePlate').innerText : "Unknown Plate";
    
    // 3. Inject the real data into the SOS screen so the user can read it to the police
    const sosNameEl = document.getElementById('sosDriverNameText');
    const sosPlateEl = document.getElementById('sosVehiclePlateText');
    const sosLocEl = document.getElementById('sosLocationText');

    if (sosNameEl) sosNameEl.innerText = driverName;
    if (sosPlateEl) sosPlateEl.innerText = vehiclePlate;
    
    if (sosLocEl && currentRideDetails && currentRideDetails.pickup) {
        sosLocEl.innerText = currentRideDetails.pickup.name || "Live GPS tracking active";
    }

    // 4. Silently update Firebase to flag this ride as an Emergency
    if (currentRiderRideId && db) {
        try {
            db.collection('rides').doc(currentRiderRideId).update({ 
                sosTriggered: true,
                sosTimestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log("SOS Alert securely logged to database.");
        } catch (e) {
            console.error("Failed to log SOS to database.", e);
        }
    }
}

function closeSOS() {
    const sosOverlay = document.getElementById('sosEmergencyOverlay');
    if (sosOverlay) sosOverlay.style.display = 'none';
    
    // Optionally remove the SOS flag if it was a false alarm
    if (currentRiderRideId && db) {
        db.collection('rides').doc(currentRiderRideId).update({ 
            sosTriggered: false 
        }).catch(e => console.warn(e));
    }
}
// =============================================================================
// PLATFORM REFERRAL AND SHARE LOGIC UTILITIES
// =============================================================================

let activeReferralCode = "";

function initializeReferralEngine() {
    if (!currentUser) return;
    
    // Generate an authentic unique referral code mapping the user session parameters
    const cleanedUid = currentUser.uid.substring(0, 5).toUpperCase();
    activeReferralCode = `RS${cleanedUid}`;
    
    // Update the UI token field text container
    const codeDisplay = document.getElementById('displayReferralCodeText');
    if (codeDisplay) codeDisplay.innerText = activeReferralCode;

    // Mutate the QR code target source URL to securely payload our user referral tracking code parameters
    const qrImage = document.getElementById('referralQrImageElement');
    if (qrImage) {
        const structuralDeepLink = `https://rapidsafe.in/invite?code=${activeReferralCode}`;
        qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(structuralDeepLink)}`;
    }
}

function openReferQrModal() {
    const overlay = document.getElementById('referQrModalOverlay');
    if (overlay) overlay.style.display = 'flex';
}

function closeReferQrModal() {
    const overlay = document.getElementById('referQrModalOverlay');
    if (overlay) overlay.style.display = 'none';
}

function triggerReferralShare() {
    const referralDeepLink = `https://rapidsafe.in/invite?code=${activeReferralCode}`;
    
    // Pixel-perfect message structure matching the Namma Yatri text block design rules
    const shareMessageString = 
        `Hey there!\n\n` +
        `Experience RapidSafe — a modern, cashless transit platform built explicitly for optimized independent commute tracking.\n\n` +
        `🔒 100% Secure Architecture\n` +
        `💳 Cashless Payment Gateways\n` +
        `🌱 Smart Transit Protocol\n\n` +
        `Download the app using my referral code link to get started instantly!\n\n` +
        `Referral Code: ${activeReferralCode}\n\n` +
        `${referralDeepLink}`;

    // Condition A: If running inside native mobile web browsers with active sharing protocols
    if (navigator.share) {
        navigator.share({
            title: 'Join RapidSafe',
            text: shareMessageString,
            url: referralDeepLink
        })
        .then(() => console.log('Referral shared successfully.'))
        .catch((error) => console.log('Share canceled or failed', error));
    } 
    // Condition B: Fallback directly mapping a localized WhatsApp link frame redirection setup
    else {
        const mobileWhatsappIntentUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareMessageString)}`;
        window.open(mobileWhatsappIntentUrl, '_blank');
    }
}