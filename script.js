// ============================================
// Weather ML Predictor with Real Historical Data
// ============================================

const API_KEY = 'f032684d97197832270cc8a21104e467';

// ============================================
// API Functions
// ============================================

async function getGeo(city) {
    try {
        const response = await fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${city}&limit=1&appid=${API_KEY}`);
        
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.length === 0) {
            throw new Error('City not found');
        }

        console.log(data)
        
        return {
            name: data[0].name,
            lat: data[0].lat,
            lon: data[0].lon,
            country: data[0].country,
            state: data[0].state || ''
        };

    } catch (error) {
        console.error(`Geocoding Error: ${error.message}`);
        throw error;
    }
}

async function getCurrentWeather(city) {
    try {
        const geo = await getGeo(city);
        const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${geo.lat}&lon=${geo.lon}&units=metric&appid=${API_KEY}`);
        
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        
        return {
            location: {
                city: geo.name,
                country: geo.country,
                state: geo.state,
                lat: geo.lat,
                lon: geo.lon
            },
            current: {
                temp: data.main.temp,
                feelsLike: data.main.feels_like,
                humidity: data.main.humidity,
                pressure: data.main.pressure,
                windSpeed: data.wind.speed,
                visibility: data.visibility / 1000,
                conditions: data.weather[0].description,
                icon: data.weather[0].icon,
                main: data.weather[0].main
            },
            sun: {
                sunrise: data.sys.sunrise,
                sunset: data.sys.sunset
            },
            timezone: data.timezone,
            timestamp: data.dt
        };
    } catch (error) {
        console.error(`Current Weather Error: ${error.message}`);
        throw error;
    }
}

async function get3HourForecast(city) {
    try {
        const geo = await getGeo(city);
        const response = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${geo.lat}&lon=${geo.lon}&units=metric&appid=${API_KEY}`);
        
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        
        // Extract historical-like data from forecast for better prediction
        const pastData = data.list.slice(0, 8).map((item, index) => ({
            day: index,
            temp: item.main.temp,
            date: new Date(item.dt * 1000),
            humidity: item.main.humidity,
            conditions: item.weather[0].description
        }));
        
        // Process 3-hour forecast data (OpenWeather gives data in 3-hour intervals)
        // Take every data point since they're already 3 hours apart
        const threeHourForecast = data.list.slice(0, 8).map(item => ({
            time: item.dt,
            temp: item.main.temp,
            humidity: item.main.humidity,
            conditions: item.weather[0].description,
            icon: item.weather[0].icon,
            main: item.weather[0].main,
            pop: item.pop * 100
        }));
        
        // Get tomorrow's forecast data
        const tomorrowData = data.list.slice(0, 8);
        const tomorrowTemps = tomorrowData.map(d => d.main.temp);
        const tomorrowHigh = Math.max(...tomorrowTemps);
        const tomorrowLow = Math.min(...tomorrowTemps);
        const tomorrowMidday = tomorrowData[Math.floor(tomorrowData.length / 2)];
        
        return {
            threeHour: threeHourForecast,
            pastData: pastData,
            tomorrow: {
                high: tomorrowHigh,
                low: tomorrowLow,
                icon: tomorrowMidday.weather[0].icon,
                conditions: tomorrowMidday.weather[0].description,
                main: tomorrowMidday.weather[0].main
            }
        };
    } catch (error) {
        console.error(`Forecast Error: ${error.message}`);
        throw error;
    }
}

// ============================================
// Linear Regression ML Functions
// ============================================

function calculateLinearRegression(data) {
    const n = data.length;
    
    if (n === 0) return { slope: 0, intercept: 0 };
    
    // Calculate means
    const xMean = data.reduce((sum, d) => sum + d.day, 0) / n;
    const yMean = data.reduce((sum, d) => sum + d.temp, 0) / n;
    
    // Calculate slope and intercept
    let numerator = 0;
    let denominator = 0;
    
    for (let i = 0; i < n; i++) {
        numerator += (data[i].day - xMean) * (data[i].temp - yMean);
        denominator += (data[i].day - xMean) ** 2;
    }
    
    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = yMean - slope * xMean;
    
    return { slope, intercept };
}

function predictTemperature(historicalData) {
    const { slope, intercept } = calculateLinearRegression(historicalData);
    const nextDay = historicalData.length;
    const prediction = slope * nextDay + intercept;
    
    // Calculate R-squared (confidence measure)
    const yMean = historicalData.reduce((sum, d) => sum + d.temp, 0) / historicalData.length;
    let ssTotal = 0;
    let ssResidual = 0;
    
    historicalData.forEach(d => {
        const predicted = slope * d.day + intercept;
        ssTotal += (d.temp - yMean) ** 2;
        ssResidual += (d.temp - predicted) ** 2;
    });
    
    const rSquared = ssTotal !== 0 ? 1 - (ssResidual / ssTotal) : 0;
    const confidence = Math.max(0, Math.min(100, rSquared * 100));
    
    return {
        prediction,
        slope,
        intercept,
        confidence
    };
}

function predictWeatherData(currentWeather, historicalData) {
    // Use real historical data for prediction
    const tempPrediction = predictTemperature(historicalData);
    
    return {
        historical: historicalData,
        prediction: {
            temp: tempPrediction.prediction,
            confidence: tempPrediction.confidence,
            tempChange: tempPrediction.prediction - currentWeather.current.temp
        },
        regression: {
            slope: tempPrediction.slope,
            intercept: tempPrediction.intercept
        }
    };
}

// ============================================
// Main Weather Data Object Builder
// ============================================

async function getCompleteWeatherData(city) {
    try {
        // Fetch current weather and forecast
        const [currentData, forecastData] = await Promise.all([
            getCurrentWeather(city),
            get3HourForecast(city)
        ]);
        
        // Use forecast data as historical proxy (best available with free API)
        const historicalData = forecastData.pastData;
        
        // Generate ML predictions using real data
        const mlPredictions = predictWeatherData(currentData, historicalData);
        
        // Build complete data object
        const completeData = {
            location: currentData.location,
            current: currentData.current,
            sun: currentData.sun,
            timezone: currentData.timezone,
            forecast: {
                threeHour: forecastData.threeHour,
                tomorrow: forecastData.tomorrow
            },
            ml: {
                historical: mlPredictions.historical,
                prediction: mlPredictions.prediction,
                regression: mlPredictions.regression
            },
            timestamp: new Date()
        };
        
        return completeData;
        
    } catch (error) {
        console.error(`Complete Weather Data Error: ${error.message}`);
        throw error;
    }
}

// ============================================
// UI Update Functions
// ============================================

function getWeatherIcon(iconCode) {
    const iconMap = {
        '01d': 'fa-sun',
        '01n': 'fa-moon',
        '02d': 'fa-cloud-sun',
        '02n': 'fa-cloud-moon',
        '03d': 'fa-cloud',
        '03n': 'fa-cloud',
        '04d': 'fa-cloud',
        '04n': 'fa-cloud',
        '09d': 'fa-cloud-rain',
        '09n': 'fa-cloud-rain',
        '10d': 'fa-cloud-sun-rain',
        '10n': 'fa-cloud-moon-rain',
        '11d': 'fa-cloud-bolt',
        '11n': 'fa-cloud-bolt',
        '13d': 'fa-snowflake',
        '13n': 'fa-snowflake',
        '50d': 'fa-smog',
        '50n': 'fa-smog'
    };
    return iconMap[iconCode] || 'fa-cloud';
}

function getIconColor(iconCode) {
    // Clear sky (01d or 01n) → Yellow
    if (iconCode.startsWith('01')) return 'text-yellow-500';
    
    // Few clouds (02d or 02n) → Lighter yellow
    if (iconCode.startsWith('02')) return 'text-yellow-400';
    
    // Scattered/broken clouds (03d, 03n, 04d, 04n) → Gray
    if (iconCode.startsWith('03') || iconCode.startsWith('04')) return 'text-gray-400';
    
    // Rain/drizzle (09d, 09n, 10d, 10n) → Blue
    if (iconCode.startsWith('09') || iconCode.startsWith('10')) return 'text-blue-400';
    
    // Thunderstorm (11d, 11n) → Purple
    if (iconCode.startsWith('11')) return 'text-purple-500';
    
    // Snow (13d, 13n) → Light blue
    if (iconCode.startsWith('13')) return 'text-blue-200';
    
    // Mist/fog (50d, 50n) → Gray
    if (iconCode.startsWith('50')) return 'text-gray-500';
    
    return 'text-gray-400'; // Default fallback
}

function formatTime(timestamp, timezoneOffset) {
    const date = new Date((timestamp + timezoneOffset) * 1000);
    return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true,
        timeZone: 'UTC'
    });
}

function updateMap(lat, lon, cityName) {
    const mapContainer = document.getElementById('map-placeholder');
    
    const googleMapsEmbed = `
        <iframe 
            width="100%" 
            height="100%" 
            frameborder="0" 
            style="border:0; border-radius: 1rem;" 
            src="https://www.google.com/maps?q=${lat},${lon}&z=11&output=embed"
            allowfullscreen
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade">
        </iframe>
    `;
    
    mapContainer.innerHTML = googleMapsEmbed;
}

function updateCurrentWeather(data) {
    // Update city and location
    document.getElementById('city-name').textContent = `${data.location.city}${data.location.state ? ', ' + data.location.state : ''}`;
    
    // Update date/time
    const now = new Date();
    document.getElementById('current-weekday').textContent = now.toLocaleDateString('en-US', { weekday: 'long' });
    document.getElementById('current-date').textContent = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    document.getElementById('current-time').textContent = `(${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })})`;
    
    // Update weather icon
    console.log('Current weather icon code:', data.current.icon);
    const iconClass = getWeatherIcon(data.current.icon);
    const iconColor = getIconColor(data.current.icon);
    console.log('Icon class:', iconClass, 'Color:', iconColor);
    
    const iconElement = document.getElementById('current-icon');
    if (iconElement) {
        // Remove ALL Font Awesome icon classes first
        iconElement.classList.remove('fa-sun', 'fa-moon', 'fa-cloud-sun', 'fa-cloud-moon', 'fa-cloud', 'fa-cloud-rain', 'fa-cloud-sun-rain', 'fa-cloud-moon-rain', 'fa-cloud-bolt', 'fa-snowflake', 'fa-smog');
        // Remove all color classes
        iconElement.classList.remove('text-yellow-500', 'text-yellow-400', 'text-gray-400', 'text-blue-400', 'text-purple-500', 'text-blue-200', 'text-gray-500', 'text-indigo-400');
        // Add the new icon and color classes
        iconElement.classList.add(iconClass);
        iconElement.classList.add(iconColor);
    }
    
    // Update temperature and description
    document.getElementById('current-temp').textContent = `${Math.round(data.current.temp)}°C`;
    document.getElementById('current-desc').textContent = data.current.conditions.charAt(0).toUpperCase() + data.current.conditions.slice(1);
    
    // Update weather details
    document.getElementById('feels-like').textContent = `${Math.round(data.current.feelsLike)}°C`;
    document.getElementById('humidity').textContent = `${Math.round(data.current.humidity)}%`;
    document.getElementById('wind-speed').textContent = `${Math.round(data.current.windSpeed * 2.237)} mph`;
    
    // Update extended details
    document.getElementById('sunrise-time').textContent = formatTime(data.sun.sunrise, data.timezone);
    document.getElementById('sunset-time').textContent = formatTime(data.sun.sunset, data.timezone);
    document.getElementById('visibility').textContent = `${Math.round(data.current.visibility)} km`;
    document.getElementById('pressure').textContent = Math.round(data.current.pressure);
    
    const visibilityDesc = data.current.visibility > 10 ? 'Excellent' : 
                          data.current.visibility > 5 ? 'Good' : 
                          data.current.visibility > 2 ? 'Moderate' : 'Poor';
    document.getElementById('visibility-desc').textContent = `${visibilityDesc} visibility`;
    
    // Update location info
    document.getElementById('location-city').textContent = `${data.location.city}${data.location.state ? ', ' + data.location.state : ''}`;
    document.getElementById('location-country').textContent = data.location.country;
    document.getElementById('location-coords').textContent = `${data.location.lat.toFixed(4)}° N, ${Math.abs(data.location.lon).toFixed(4)}° ${data.location.lon > 0 ? 'E' : 'W'}`;
    
    // Update map
    updateMap(data.location.lat, data.location.lon, data.location.city);
}

function updateTomorrowPrediction(data) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Update tomorrow's date
    document.getElementById('tomorrow-date').textContent = tomorrow.toLocaleDateString('en-US', { 
        weekday: 'long',
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
    });
    
    // Update prediction temperature
    const predictedTemp = Math.round(data.ml.prediction.temp);
    document.getElementById('tomorrow-temp').textContent = `${predictedTemp}°C`;
    
    // Update temperature change
    const tempChange = data.ml.prediction.tempChange;
    const changeElement = document.getElementById('tomorrow-change');
    const isIncrease = tempChange >= 0;
    const changeText = `${isIncrease ? '↑↑' : '↓↓'} ${Math.abs(tempChange).toFixed(1)}°C from today`;
    
    changeElement.textContent = changeText;
    changeElement.className = `text-xl ${isIncrease ? 'text-red-600' : 'text-blue-600'} mb-8`;
    
    // Update high/low
    document.getElementById('tomorrow-high').textContent = `${Math.round(data.forecast.tomorrow.high)}°C`;
    document.getElementById('tomorrow-low').textContent = `${Math.round(data.forecast.tomorrow.low)}°C`;
    
    // Update tomorrow's icon
    console.log('Tomorrow weather icon code:', data.forecast.tomorrow.icon);
    const iconClass = getWeatherIcon(data.forecast.tomorrow.icon);
    const iconColor = getIconColor(data.forecast.tomorrow.icon);
    console.log('Tomorrow icon class:', iconClass, 'Color:', iconColor);
    
    const iconElement = document.getElementById('tomorrow-icon');
    if (iconElement) {
        // Remove ALL Font Awesome icon classes first
        iconElement.classList.remove('fa-sun', 'fa-moon', 'fa-cloud-sun', 'fa-cloud-moon', 'fa-cloud', 'fa-cloud-rain', 'fa-cloud-sun-rain', 'fa-cloud-moon-rain', 'fa-cloud-bolt', 'fa-snowflake', 'fa-smog');
        // Remove all color classes
        iconElement.classList.remove('text-yellow-500', 'text-yellow-400', 'text-gray-400', 'text-blue-400', 'text-purple-500', 'text-blue-200', 'text-gray-500', 'text-indigo-400');
        // Add the new icon and color classes
        iconElement.classList.add(iconClass);
        iconElement.classList.add(iconColor);
    }
    
    // Update tomorrow's description
    const conditions = data.forecast.tomorrow.conditions.charAt(0).toUpperCase() + data.forecast.tomorrow.conditions.slice(1);
    document.getElementById('tomorrow-desc').textContent = conditions;
    
    // Update ML insights
    const confidence = Math.round(data.ml.prediction.confidence);
    document.getElementById('ml-confidence').textContent = `${confidence}%`;
    
    const confidenceBar = document.getElementById('confidence-bar');
    if (confidenceBar) {
        confidenceBar.style.width = `${confidence}%`;
    }
    
    // Update regression formula
    const formula = `y = ${data.ml.regression.slope.toFixed(2)}x + ${data.ml.regression.intercept.toFixed(2)}`;
    document.getElementById('regression-formula').textContent = formula;
    
    // Update data points info
    document.getElementById('historical-days').textContent = `Based on ${data.ml.historical.length} data points from forecast`;
    
    // Update conditions
    document.getElementById('tomorrow-conditions').textContent = conditions;
    
    // Update temperature chart
    updateTemperatureChart(data.ml.historical, data.ml.prediction.temp);
}

function updateTemperatureChart(historicalData, prediction) {
    const chartContainer = document.getElementById('temperature-chart');
    const labelsContainer = document.getElementById('chart-labels');
    
    // Combine historical + prediction
    const allTemps = [...historicalData.map(d => d.temp), prediction];
    const maxTemp = Math.max(...allTemps);
    const minTemp = Math.min(...allTemps);
    
    // Calculate range with padding for better visualization
    const tempRange = maxTemp - minTemp;
    const padding = Math.max(tempRange * 0.2, 2); // 20% padding or minimum 2°C
    const chartMin = minTemp - padding;
    const chartMax = maxTemp + padding;
    const displayRange = chartMax - chartMin;
    
    // Clear existing content
    chartContainer.innerHTML = '';
    labelsContainer.innerHTML = '';
    
    // Create bars for historical data
    historicalData.forEach((data, index) => {
        const height = ((data.temp - chartMin) / displayRange) * 100;
        const bar = document.createElement('div');
        bar.className = 'flex-1 bg-blue-500 rounded-t transition-all duration-500 hover:bg-blue-600 cursor-pointer relative';
        bar.style.height = `${height}%`;
        bar.title = `Day ${historicalData.length - index}: ${data.temp.toFixed(1)}°C`;
        
        // Add temperature label ABOVE the bar (floating on top, centered, responsive)
        const tempLabel = document.createElement('div');
        tempLabel.className = 'absolute text-[8px] md:text-sm font-semibold text-gray-400 whitespace-nowrap';
        tempLabel.style.bottom = '100%';
        tempLabel.style.left = '50%';
        tempLabel.style.transform = 'translateX(-50%)';
        tempLabel.style.marginBottom = '4px';
        tempLabel.textContent = `${data.temp.toFixed(1)}°C`;
        bar.appendChild(tempLabel);
        
        chartContainer.appendChild(bar);
        
        const label = document.createElement('div');
        label.className = 'flex-1 text-center text-xs';
        label.textContent = `D-${historicalData.length - index}`;
        labelsContainer.appendChild(label);
    });
    
    // Create bar for prediction (tomorrow)
    const predHeight = ((prediction - chartMin) / displayRange) * 100;
    const predBar = document.createElement('div');
    predBar.className = 'flex-1 bg-green-500 rounded-t transition-all duration-500 hover:bg-green-600 cursor-pointer relative';
    predBar.style.height = `${predHeight}%`;
    predBar.title = `Tomorrow (Predicted): ${prediction.toFixed(1)}°C`;
    
    // Add temperature label ABOVE the bar (floating on top, centered, responsive)
    const tempLabel = document.createElement('div');
    tempLabel.className = 'absolute text-[8px] md:text-sm font-semibold text-gray-400 whitespace-nowrap';
    tempLabel.style.bottom = '100%';
    tempLabel.style.left = '50%';
    tempLabel.style.transform = 'translateX(-50%)';
    tempLabel.style.marginBottom = '4px';
    tempLabel.textContent = `${prediction.toFixed(1)}°C`;
    predBar.appendChild(tempLabel);
    
    chartContainer.appendChild(predBar);
    
    const predLabel = document.createElement('div');
    predLabel.className = 'flex-1 text-center font-bold text-xs';
    predLabel.textContent = 'Tomorrow';
    labelsContainer.appendChild(predLabel);
    
    // Log for debugging
    console.log('Chart data:', {
        historical: historicalData.map(d => d.temp),
        prediction: prediction,
        min: minTemp,
        max: maxTemp,
        chartMin: chartMin,
        chartMax: chartMax,
        range: displayRange
    });
}

function update3HourForecast(data) {
    data.forecast.threeHour.forEach((hour, index) => {
        const hourTime = new Date(hour.time * 1000);
        const timeString = hourTime.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
        
        const timeEl = document.getElementById(`hour-${index}-time`);
        const iconEl = document.getElementById(`hour-${index}-icon`);
        const tempEl = document.getElementById(`hour-${index}-temp`);
        const descEl = document.getElementById(`hour-${index}-desc`);
        
        // Update elements if they exist
        if (timeEl) timeEl.textContent = timeString;
        
        if (iconEl) {
            const iconClass = getWeatherIcon(hour.icon);
            const iconColor = getIconColor(hour.icon);
            
            // Remove ALL Font Awesome icon classes first
            iconEl.classList.remove('fa-sun', 'fa-moon', 'fa-cloud-sun', 'fa-cloud-moon', 'fa-cloud', 'fa-cloud-rain', 'fa-cloud-sun-rain', 'fa-cloud-moon-rain', 'fa-cloud-bolt', 'fa-snowflake', 'fa-smog');
            // Remove all color classes
            iconEl.classList.remove('text-yellow-500', 'text-yellow-400', 'text-gray-400', 'text-blue-400', 'text-purple-500', 'text-blue-200', 'text-gray-500', 'text-indigo-400');
            
            // Add the new icon and color classes
            iconEl.classList.add(iconClass);
            iconEl.classList.add(iconColor);
        }
        
        if (tempEl) tempEl.textContent = `${Math.round(hour.temp)}°C`;
        
        if (descEl) {
            const conditionsText = hour.conditions.charAt(0).toUpperCase() + hour.conditions.slice(1);
            descEl.textContent = conditionsText;
        }
    });
}

function updateUI(weatherData) {
    updateCurrentWeather(weatherData);
    updateTomorrowPrediction(weatherData);
    update3HourForecast(weatherData);
    
    console.log('Weather data loaded:', weatherData);
    console.log('ML Prediction for Tomorrow:', {
        temperature: `${Math.round(weatherData.ml.prediction.temp)}°C`,
        change: `${weatherData.ml.prediction.tempChange > 0 ? '+' : ''}${weatherData.ml.prediction.tempChange.toFixed(1)}°C`,
        confidence: `${Math.round(weatherData.ml.prediction.confidence)}%`,
        regression: `y = ${weatherData.ml.regression.slope.toFixed(2)}x + ${weatherData.ml.regression.intercept.toFixed(2)}`,
        dataPoints: weatherData.ml.historical.length
    });
}

// ============================================
// Main Application Logic
// ============================================

async function loadWeather(city) {
    try {
        console.log(`Loading weather for ${city}...`);
        
        const weatherData = await getCompleteWeatherData(city);
        updateUI(weatherData);
        
        return weatherData;
    } catch (error) {
        console.error('Error loading weather:', error);
        console.error('Error stack:', error.stack);
        alert(`Error loading weather data: ${error.message}`);
    }
}

// ============================================
// Event Listeners
// ============================================

window.addEventListener('load', function () {
    document.getElementById('current-year').textContent = new Date().getFullYear();

    // Load default city on page load
    loadWeather('Manila');

    const searchInput = document.getElementById('city-search');

    searchInput.addEventListener('focus', function () {
        this.classList.add('ring-2', 'ring-apple-blue', 'ring-opacity-50');
    });

    searchInput.addEventListener('blur', function () {
        this.classList.remove('ring-2', 'ring-apple-blue', 'ring-opacity-50');
    });

    document.getElementById('search-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const city = document.getElementById('city-search').value.trim();
        
        if (city) {
            await loadWeather(city);
        }
    });
    
    console.log('Weather prediction app loaded with ML-based tomorrow forecast');
    console.log('Using linear regression on real weather data from OpenWeather API');
});