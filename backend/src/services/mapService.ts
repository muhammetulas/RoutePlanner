import axios from 'axios';
import { logger } from '@/utils/logger';
import config from '@/config';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface GeocodingResult {
  place_name: string;
  center: [number, number]; // [longitude, latitude]
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: {
    accuracy?: string;
    address?: string;
    category?: string;
    maki?: string;
  };
  context?: Array<{
    id: string;
    text: string;
    short_code?: string;
  }>;
}

export interface RouteRequest {
  coordinates: [number, number][];
  profile: 'driving' | 'cycling' | 'walking';
  alternatives?: boolean;
  steps?: boolean;
  geometries?: 'geojson' | 'polyline' | 'polyline6';
  overview?: 'full' | 'simplified' | 'false';
  radiuses?: number[];
  approaches?: ('unrestricted' | 'curb')[];
}

export interface RouteResponse {
  routes: Array<{
    geometry: any;
    duration: number; // seconds
    distance: number; // meters
    weight: number;
    steps?: Array<{
      geometry: any;
      maneuver: {
        type: string;
        instruction: string;
        bearing_before?: number;
        bearing_after?: number;
        location: [number, number];
      };
      name: string;
      duration: number;
      distance: number;
      driving_side: 'left' | 'right';
      weight: number;
      mode: string;
      intersections: Array<{
        location: [number, number];
        bearings: number[];
        entry: boolean[];
        in?: number;
        out?: number;
      }>;
    }>;
  }>;
  waypoints: Array<{
    hint: string;
    distance: number;
    name: string;
    location: [number, number];
  }>;
  code: string;
  uuid?: string;
}

export interface ChargingStationSearchParams {
  latitude: number;
  longitude: number;
  radius?: number; // km
  connectorType?: string[];
  power?: number; // minimum kW
  availability?: 'available' | 'occupied' | 'unknown';
  network?: string;
}

export interface ChargingStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string;
  connectors: Array<{
    type: string;
    power: number; // kW
    count: number;
    availability: 'available' | 'occupied' | 'unknown';
  }>;
  network: string;
  amenities: string[];
  pricing?: {
    currency: string;
    perKwh?: number;
    perMinute?: number;
    sessionFee?: number;
  };
  openingHours?: string;
  phone?: string;
  website?: string;
}

class MapService {
  private mapboxApiKey: string;
  private osrmApiUrl: string;
  private openChargeMapApiKey: string;

  constructor() {
    this.mapboxApiKey = config.apis.mapbox.accessToken;
    this.osrmApiUrl = config.apis.osrm.url || 'https://router.project-osrm.org';
    this.openChargeMapApiKey = config.apis.chargingStations.apiKey || '';
  }

  /**
   * Geocoding - Convert address to coordinates
   */
  async geocode(query: string, country?: string): Promise<GeocodingResult[]> {
    try {
      const params = new URLSearchParams({
        access_token: this.mapboxApiKey,
        limit: '5',
        language: 'tr',
      });

      if (country) {
        params.append('country', country);
      }

      const response = await axios.get(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
        { params }
      );

      logger.info('Geocoding request successful', { 
        query, 
        resultsCount: response.data.features?.length || 0 
      });

      return response.data.features || [];
    } catch (error) {
      logger.error('Geocoding failed', { query, error: error instanceof Error ? error.message : String(error) });
      throw new Error('Geocoding service unavailable');
    }
  }

  /**
   * Reverse Geocoding - Convert coordinates to address
   */
  async reverseGeocode(longitude: number, latitude: number): Promise<GeocodingResult[]> {
    try {
      const response = await axios.get(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json`,
        {
          params: {
            access_token: this.mapboxApiKey,
            language: 'tr',
            types: 'address,poi',
          },
        }
      );

      logger.info('Reverse geocoding request successful', { 
        longitude, 
        latitude, 
        resultsCount: response.data.features?.length || 0 
      });

      return response.data.features || [];
    } catch (error) {
      logger.error('Reverse geocoding failed', { longitude, latitude, error: error instanceof Error ? error.message : String(error) });
      throw new Error('Reverse geocoding service unavailable');
    }
  }

  /**
   * Calculate route between coordinates using OSRM
   */
  async calculateRoute(request: RouteRequest): Promise<RouteResponse> {
    try {
      const coordinatesStr = request.coordinates
        .map(coord => `${coord[0]},${coord[1]}`)
        .join(';');

      const params = new URLSearchParams({
        alternatives: request.alternatives?.toString() || 'false',
        steps: request.steps?.toString() || 'false',
        geometries: request.geometries || 'geojson',
        overview: request.overview || 'simplified',
      });

      if (request.radiuses) {
        params.append('radiuses', request.radiuses.join(';'));
      }

      if (request.approaches) {
        params.append('approaches', request.approaches.join(';'));
      }

      const response = await axios.get(
        `${this.osrmApiUrl}/route/v1/${request.profile}/${coordinatesStr}`,
        { params }
      );

      if (response.data.code !== 'Ok') {
        throw new Error(`OSRM error: ${response.data.message || response.data.code}`);
      }

      logger.info('Route calculation successful', { 
        coordinatesCount: request.coordinates.length,
        profile: request.profile,
        routesCount: response.data.routes?.length || 0
      });

      return response.data;
    } catch (error) {
      logger.error('Route calculation failed', { request, error: error instanceof Error ? error.message : String(error) });
      throw new Error('Route calculation service unavailable');
    }
  }

  /**
   * Calculate optimized route for multiple waypoints
   */
  async calculateOptimizedTrip(coordinates: [number, number][], profile: 'driving' | 'cycling' = 'driving'): Promise<RouteResponse> {
    try {
      const coordinatesStr = coordinates
        .map(coord => `${coord[0]},${coord[1]}`)
        .join(';');

      const response = await axios.get(
        `${this.osrmApiUrl}/trip/v1/${profile}/${coordinatesStr}`,
        {
          params: {
            steps: 'true',
            geometries: 'geojson',
            overview: 'full',
          },
        }
      );

      if (response.data.code !== 'Ok') {
        throw new Error(`OSRM trip error: ${response.data.message || response.data.code}`);
      }

      logger.info('Optimized trip calculation successful', { 
        coordinatesCount: coordinates.length,
        profile
      });

      return response.data;
    } catch (error) {
      logger.error('Optimized trip calculation failed', { coordinates, profile, error: error instanceof Error ? error.message : String(error) });
      throw new Error('Trip optimization service unavailable');
    }
  }

  /**
   * Search for charging stations near coordinates
   */
  async searchChargingStations(params: ChargingStationSearchParams): Promise<ChargingStation[]> {
    try {
      // Using OpenChargeMap API
      const searchParams = new URLSearchParams({
        key: this.openChargeMapApiKey,
        latitude: params.latitude.toString(),
        longitude: params.longitude.toString(),
        distance: (params.radius || 10).toString(),
        distanceunit: 'KM',
        maxresults: '50',
        compact: 'true',
        verbose: 'false',
      });

      if (params.power) {
        searchParams.append('minpowerkw', params.power.toString());
      }

      const response = await axios.get(
        'https://api.openchargemap.io/v3/poi',
        { params: searchParams }
      );

      const stations: ChargingStation[] = response.data.map((station: any) => ({
        id: station.ID.toString(),
        name: station.AddressInfo?.Title || 'Unknown Station',
        latitude: station.AddressInfo?.Latitude || 0,
        longitude: station.AddressInfo?.Longitude || 0,
        address: [
          station.AddressInfo?.AddressLine1,
          station.AddressInfo?.Town,
          station.AddressInfo?.StateOrProvince,
          station.AddressInfo?.Country?.Title,
        ].filter(Boolean).join(', '),
        connectors: station.Connections?.map((conn: any) => ({
          type: conn.ConnectionType?.Title || 'Unknown',
          power: conn.PowerKW || 0,
          count: conn.Quantity || 1,
          availability: this.mapOCMAvailability(conn.StatusType?.ID),
        })) || [],
        network: station.OperatorInfo?.Title || 'Unknown',
        amenities: station.GeneralComments ? [station.GeneralComments] : [],
        openingHours: station.AddressInfo?.AccessComments,
        phone: station.AddressInfo?.ContactTelephone1,
        website: station.AddressInfo?.RelatedURL,
      }));

      logger.info('Charging stations search successful', { 
        params,
        stationsCount: stations.length
      });

      return stations;
    } catch (error) {
      logger.error('Charging stations search failed', { params, error: error instanceof Error ? error.message : String(error) });
      throw new Error('Charging stations service unavailable');
    }
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  calculateDistance(coord1: Coordinates, coord2: Coordinates): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(coord2.latitude - coord1.latitude);
    const dLon = this.toRadians(coord2.longitude - coord1.longitude);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(coord1.latitude)) * Math.cos(this.toRadians(coord2.latitude)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Check if coordinates are within Turkey bounds
   */
  isWithinTurkeyBounds(longitude: number, latitude: number): boolean {
    // Turkey approximate bounds
    const bounds = {
      north: 42.1,
      south: 35.8,
      east: 44.8,
      west: 25.7,
    };

    return longitude >= bounds.west && 
           longitude <= bounds.east && 
           latitude >= bounds.south && 
           latitude <= bounds.north;
  }

  /**
   * Get map style URL for different themes
   */
  getMapStyleUrl(style: 'streets' | 'satellite' | 'outdoors' | 'light' | 'dark' = 'streets'): string {
    const styleMap = {
      streets: 'mapbox://styles/mapbox/streets-v12',
      satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
      outdoors: 'mapbox://styles/mapbox/outdoors-v12',
      light: 'mapbox://styles/mapbox/light-v11',
      dark: 'mapbox://styles/mapbox/dark-v11',
    };

    return styleMap[style];
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private mapOCMAvailability(statusId: number): 'available' | 'occupied' | 'unknown' {
    // OpenChargeMap status IDs mapping
    switch (statusId) {
      case 50: // Operational
        return 'available';
      case 30: // Temporarily Unavailable
      case 150: // Out of Service
        return 'occupied';
      default:
        return 'unknown';
    }
  }
}

export const mapService = new MapService(); 
