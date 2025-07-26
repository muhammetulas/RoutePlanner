import { Router } from 'express';
import Joi from 'joi';
import { asyncHandler } from '@/middleware/errorHandler';
import { authMiddleware } from '@/middleware/auth';
import { mapService, RouteRequest, ChargingStationSearchParams } from '@/services/mapService';
import { logger } from '@/utils/logger';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting for map API calls
const mapRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many map requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all map routes
router.use(mapRateLimit);

// Validation schemas
const geocodeSchema = Joi.object({
  query: Joi.string().required().min(2).max(200),
  country: Joi.string().length(2).optional(),
});

const reverseGeocodeSchema = Joi.object({
  longitude: Joi.number().min(-180).max(180).required(),
  latitude: Joi.number().min(-90).max(90).required(),
});

const routeSchema = Joi.object({
  coordinates: Joi.array()
    .items(
      Joi.array()
        .length(2)
        .items(Joi.number().min(-180).max(180), Joi.number().min(-90).max(90))
    )
    .min(2)
    .max(25)
    .required(),
  profile: Joi.string().valid('driving', 'cycling', 'walking').default('driving'),
  alternatives: Joi.boolean().default(false),
  steps: Joi.boolean().default(true),
  geometries: Joi.string().valid('geojson', 'polyline', 'polyline6').default('geojson'),
  overview: Joi.string().valid('full', 'simplified', 'false').default('simplified'),
  radiuses: Joi.array().items(Joi.number().min(0)).optional(),
  approaches: Joi.array().items(Joi.string().valid('unrestricted', 'curb')).optional(),
});

const chargingStationsSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  radius: Joi.number().min(1).max(100).default(10),
  connectorType: Joi.array().items(Joi.string()).optional(),
  power: Joi.number().min(0).max(500).optional(),
  availability: Joi.string().valid('available', 'occupied', 'unknown').optional(),
  network: Joi.string().optional(),
});

/**
 * @swagger
 * /api/map/geocode:
 *   get:
 *     summary: Geocode address to coordinates
 *     tags: [Map]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *           maxLength: 200
 *         description: Address or place name to geocode
 *       - in: query
 *         name: country
 *         schema:
 *           type: string
 *           pattern: '^[A-Z]{2}$'
 *         description: Country code to limit search (e.g., TR)
 *     responses:
 *       200:
 *         description: Geocoding results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/GeocodingResult'
 */
router.get('/geocode', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value } = geocodeSchema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.details.map(detail => detail.message),
    });
  }

  const { query, country } = value;
  const results = await mapService.geocode(query, country);

  logger.info('Geocoding API request', { 
    userId: req.user?.id,
    query,
    country,
    resultsCount: results.length
  });

  res.json({
    success: true,
    data: results,
  });
}));

/**
 * @swagger
 * /api/map/reverse-geocode:
 *   get:
 *     summary: Reverse geocode coordinates to address
 *     tags: [Map]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: longitude
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -180
 *           maximum: 180
 *       - in: query
 *         name: latitude
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -90
 *           maximum: 90
 *     responses:
 *       200:
 *         description: Reverse geocoding results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/GeocodingResult'
 */
router.get('/reverse-geocode', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value } = reverseGeocodeSchema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.details.map(detail => detail.message),
    });
  }

  const { longitude, latitude } = value;
  const results = await mapService.reverseGeocode(longitude, latitude);

  logger.info('Reverse geocoding API request', { 
    userId: req.user?.id,
    longitude,
    latitude,
    resultsCount: results.length
  });

  res.json({
    success: true,
    data: results,
  });
}));

/**
 * @swagger
 * /api/map/route:
 *   post:
 *     summary: Calculate route between coordinates
 *     tags: [Map]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RouteRequest'
 *     responses:
 *       200:
 *         description: Route calculation results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/RouteResponse'
 */
router.post('/route', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value } = routeSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.details.map(detail => detail.message),
    });
  }

  const routeRequest: RouteRequest = value;
  const route = await mapService.calculateRoute(routeRequest);

  logger.info('Route calculation API request', { 
    userId: req.user?.id,
    coordinatesCount: routeRequest.coordinates.length,
    profile: routeRequest.profile,
    routesCount: route.routes?.length || 0
  });

  res.json({
    success: true,
    data: route,
  });
}));

/**
 * @swagger
 * /api/map/trip:
 *   post:
 *     summary: Calculate optimized trip for multiple waypoints
 *     tags: [Map]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               coordinates:
 *                 type: array
 *                 items:
 *                   type: array
 *                   items:
 *                     type: number
 *                   minItems: 2
 *                   maxItems: 2
 *                 minItems: 3
 *                 maxItems: 12
 *               profile:
 *                 type: string
 *                 enum: [driving, cycling]
 *                 default: driving
 *     responses:
 *       200:
 *         description: Optimized trip results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/RouteResponse'
 */
router.post('/trip', authMiddleware, asyncHandler(async (req, res) => {
  const tripSchema = Joi.object({
    coordinates: Joi.array()
      .items(
        Joi.array()
          .length(2)
          .items(Joi.number().min(-180).max(180), Joi.number().min(-90).max(90))
      )
      .min(3)
      .max(12)
      .required(),
    profile: Joi.string().valid('driving', 'cycling').default('driving'),
  });

  const { error, value } = tripSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.details.map(detail => detail.message),
    });
  }

  const { coordinates, profile } = value;
  const trip = await mapService.calculateOptimizedTrip(coordinates, profile);

  logger.info('Trip optimization API request', { 
    userId: req.user?.id,
    coordinatesCount: coordinates.length,
    profile
  });

  res.json({
    success: true,
    data: trip,
  });
}));

/**
 * @swagger
 * /api/map/charging-stations:
 *   get:
 *     summary: Search for charging stations near coordinates
 *     tags: [Map]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: latitude
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -90
 *           maximum: 90
 *       - in: query
 *         name: longitude
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -180
 *           maximum: 180
 *       - in: query
 *         name: radius
 *         schema:
 *           type: number
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Search radius in kilometers
 *       - in: query
 *         name: power
 *         schema:
 *           type: number
 *           minimum: 0
 *           maximum: 500
 *         description: Minimum power in kW
 *       - in: query
 *         name: availability
 *         schema:
 *           type: string
 *           enum: [available, occupied, unknown]
 *         description: Filter by availability status
 *       - in: query
 *         name: network
 *         schema:
 *           type: string
 *         description: Filter by charging network
 *     responses:
 *       200:
 *         description: Charging stations search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ChargingStation'
 */
router.get('/charging-stations', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value } = chargingStationsSchema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.details.map(detail => detail.message),
    });
  }

  const searchParams: ChargingStationSearchParams = value;
  const stations = await mapService.searchChargingStations(searchParams);

  logger.info('Charging stations search API request', { 
    userId: req.user?.id,
    searchParams,
    stationsCount: stations.length
  });

  res.json({
    success: true,
    data: stations,
  });
}));

/**
 * @swagger
 * /api/map/distance:
 *   get:
 *     summary: Calculate distance between two coordinates
 *     tags: [Map]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: lat1
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -90
 *           maximum: 90
 *       - in: query
 *         name: lon1
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -180
 *           maximum: 180
 *       - in: query
 *         name: lat2
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -90
 *           maximum: 90
 *       - in: query
 *         name: lon2
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -180
 *           maximum: 180
 *     responses:
 *       200:
 *         description: Distance calculation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     distance:
 *                       type: number
 *                       description: Distance in kilometers
 */
router.get('/distance', authMiddleware, asyncHandler(async (req, res) => {
  const distanceSchema = Joi.object({
    lat1: Joi.number().min(-90).max(90).required(),
    lon1: Joi.number().min(-180).max(180).required(),
    lat2: Joi.number().min(-90).max(90).required(),
    lon2: Joi.number().min(-180).max(180).required(),
  });

  const { error, value } = distanceSchema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.details.map(detail => detail.message),
    });
  }

  const { lat1, lon1, lat2, lon2 } = value;
  const distance = mapService.calculateDistance(
    { latitude: lat1, longitude: lon1 },
    { latitude: lat2, longitude: lon2 }
  );

  logger.info('Distance calculation API request', { 
    userId: req.user?.id,
    coordinates: [lat1, lon1, lat2, lon2],
    distance
  });

  res.json({
    success: true,
    data: { distance },
  });
}));

/**
 * @swagger
 * /api/map/styles:
 *   get:
 *     summary: Get available map styles
 *     tags: [Map]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Available map styles
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     styles:
 *                       type: object
 *                       additionalProperties:
 *                         type: string
 */
router.get('/styles', authMiddleware, asyncHandler(async (req, res) => {
  const styles = {
    streets: mapService.getMapStyleUrl('streets'),
    satellite: mapService.getMapStyleUrl('satellite'),
    outdoors: mapService.getMapStyleUrl('outdoors'),
    light: mapService.getMapStyleUrl('light'),
    dark: mapService.getMapStyleUrl('dark'),
  };

  res.json({
    success: true,
    data: { styles },
  });
}));

export default router; 
