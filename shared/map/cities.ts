// Cities on the Rocky Way North America board.
export interface City {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export const CITIES: City[] = [
  // Pacific
  { id: 'vancouver', name: 'Vancouver', lat: 49.28, lon: -123.12 },
  { id: 'portland', name: 'Portland', lat: 45.52, lon: -122.68 },
  { id: 'sanfrancisco', name: 'San Francisco', lat: 37.77, lon: -122.42 },
  { id: 'losangeles', name: 'Los Angeles', lat: 34.05, lon: -118.24 },
  // Canadian west & prairies
  { id: 'edmonton', name: 'Edmonton', lat: 53.55, lon: -113.49 },
  { id: 'calgary', name: 'Calgary', lat: 51.05, lon: -114.07 },
  { id: 'regina', name: 'Regina', lat: 50.45, lon: -104.61 },
  { id: 'winnipeg', name: 'Winnipeg', lat: 49.9, lon: -97.14 },
  // Mountain west
  { id: 'spokane', name: 'Spokane', lat: 47.66, lon: -117.43 },
  { id: 'boise', name: 'Boise', lat: 43.62, lon: -116.2 },
  { id: 'reno', name: 'Reno', lat: 39.53, lon: -119.81 },
  { id: 'saltlake', name: 'Salt Lake City', lat: 40.76, lon: -111.89 },
  { id: 'billings', name: 'Billings', lat: 45.78, lon: -108.5 },
  { id: 'lasvegas', name: 'Las Vegas', lat: 36.17, lon: -115.14 },
  { id: 'phoenix', name: 'Phoenix', lat: 33.45, lon: -112.07 },
  { id: 'albuquerque', name: 'Albuquerque', lat: 35.08, lon: -106.65 },
  { id: 'denver', name: 'Denver', lat: 39.74, lon: -104.99 },
  { id: 'bismarck', name: 'Bismarck', lat: 46.81, lon: -100.78 },
  // Mexico
  { id: 'hermosillo', name: 'Hermosillo', lat: 29.07, lon: -110.96 },
  { id: 'chihuahua', name: 'Chihuahua', lat: 28.63, lon: -106.07 },
  { id: 'mazatlan', name: 'Mazatlán', lat: 23.25, lon: -106.41 },
  { id: 'monterrey', name: 'Monterrey', lat: 25.69, lon: -100.32 },
  { id: 'guadalajara', name: 'Guadalajara', lat: 20.67, lon: -103.35 },
  { id: 'mexicocity', name: 'Mexico City', lat: 19.43, lon: -99.13 },
  // Heartland
  { id: 'minneapolis', name: 'Minneapolis', lat: 44.98, lon: -93.27 },
  { id: 'omaha', name: 'Omaha', lat: 41.26, lon: -95.93 },
  { id: 'kansascity', name: 'Kansas City', lat: 39.1, lon: -94.58 },
  { id: 'oklahomacity', name: 'Oklahoma City', lat: 35.47, lon: -97.52 },
  { id: 'dallas', name: 'Dallas', lat: 32.78, lon: -96.8 },
  { id: 'sanantonio', name: 'San Antonio', lat: 29.42, lon: -98.49 },
  { id: 'houston', name: 'Houston', lat: 29.76, lon: -95.37 },
  { id: 'neworleans', name: 'New Orleans', lat: 29.95, lon: -90.07 },
  { id: 'memphis', name: 'Memphis', lat: 35.15, lon: -90.05 },
  { id: 'stlouis', name: 'St. Louis', lat: 38.63, lon: -90.2 },
  { id: 'chicago', name: 'Chicago', lat: 41.88, lon: -87.63 },
  { id: 'louisville', name: 'Louisville', lat: 38.25, lon: -85.76 },
  { id: 'detroit', name: 'Detroit', lat: 42.33, lon: -83.05 },
  { id: 'thunderbay', name: 'Thunder Bay', lat: 48.38, lon: -89.25 },
  // East
  { id: 'sudbury', name: 'Sudbury', lat: 46.49, lon: -80.99 },
  { id: 'toronto', name: 'Toronto', lat: 43.65, lon: -79.38 },
  { id: 'montreal', name: 'Montréal', lat: 45.5, lon: -73.57 },
  { id: 'halifax', name: 'Halifax', lat: 44.65, lon: -63.57 },
  { id: 'boston', name: 'Boston', lat: 42.36, lon: -71.06 },
  { id: 'newyork', name: 'New York', lat: 40.71, lon: -74.01 },
  { id: 'washington', name: 'Washington', lat: 38.91, lon: -77.04 },
  { id: 'charlotte', name: 'Charlotte', lat: 35.23, lon: -80.84 },
  { id: 'atlanta', name: 'Atlanta', lat: 33.75, lon: -84.39 },
  { id: 'jacksonville', name: 'Jacksonville', lat: 30.33, lon: -81.66 },
  { id: 'miami', name: 'Miami', lat: 25.76, lon: -80.19 },
];
