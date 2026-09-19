'use strict';

const byeMoneyPurchaseService = require('../../../src/services/byeMoneyPurchaseService');
const integrationController = require('../../../src/api/integration/controllers/integration');

describe('ByeMoney Purchase Confirmation Webhook', () => {
  let mockStrapi;
  let mockDbQueries;

  beforeEach(() => {
    mockDbQueries = {
      'api::byemoney-purchase-log.byemoney-purchase-log': {
        findOne: jest.fn(),
        create: jest.fn(),
      },
      'plugin::users-permissions.user': {
        findOne: jest.fn(),
        update: jest.fn(),
      },
      'api::course.course': {
        findOne: jest.fn(),
        update: jest.fn(),
      },
    };

    mockStrapi = {
      db: {
        query: jest.fn((model) => {
          if (!mockDbQueries[model]) {
            throw new Error(`Unexpected query model: ${model}`);
          }
          return mockDbQueries[model];
        }),
      },
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    };

    global.strapi = mockStrapi;
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete global.strapi;
  });

  describe('Validation (Missing or Invalid Payload)', () => {
    it('should return 400 when payload is empty or not an object', async () => {
      const resultNull = await byeMoneyPurchaseService.confirmPurchase(null, { strapiInstance: mockStrapi });
      expect(resultNull.httpStatus).toBe(400);
      expect(resultNull.response).toEqual({
        success: false,
        purchaseId: '',
        status: 'error',
        message: expect.stringContaining('JSON object'),
      });

      const resultArr = await byeMoneyPurchaseService.confirmPurchase([], { strapiInstance: mockStrapi });
      expect(resultArr.httpStatus).toBe(400);
      expect(resultArr.response.status).toBe('error');
    });

    it('should return 400 when purchaseId is missing or empty', async () => {
      const result = await byeMoneyPurchaseService.confirmPurchase(
        { strapiUserId: 'usr_1', courseId: 'crs_1' },
        { strapiInstance: mockStrapi }
      );
      expect(result.httpStatus).toBe(400);
      expect(result.response).toEqual({
        success: false,
        purchaseId: '',
        status: 'error',
        message: expect.stringContaining('purchaseId is required'),
      });
    });

    it('should return 400 when strapiUserId is missing or empty', async () => {
      const result = await byeMoneyPurchaseService.confirmPurchase(
        { purchaseId: 'pur_123', courseId: 'crs_1' },
        { strapiInstance: mockStrapi }
      );
      expect(result.httpStatus).toBe(400);
      expect(result.response).toEqual({
        success: false,
        purchaseId: 'pur_123',
        status: 'error',
        message: expect.stringContaining('strapiUserId is required'),
      });
    });

    it('should return 400 when courseId is missing or empty', async () => {
      const result = await byeMoneyPurchaseService.confirmPurchase(
        { purchaseId: 'pur_123', strapiUserId: 'usr_1', courseId: '   ' },
        { strapiInstance: mockStrapi }
      );
      expect(result.httpStatus).toBe(400);
      expect(result.response).toEqual({
        success: false,
        purchaseId: 'pur_123',
        status: 'error',
        message: expect.stringContaining('courseId is required'),
      });
    });
  });

  describe('First-Time Grant', () => {
    it('should grant access, log purchase, and return 200 with status "granted"', async () => {
      const payload = {
        purchaseId: 'bm_pur_100',
        strapiUserId: 'usr_doc_10',
        courseId: 'crs_doc_20',
      };

      // 1. Log lookup returns null (first time)
      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne.mockResolvedValue(null);

      // 2. User lookup succeeds
      mockDbQueries['plugin::users-permissions.user'].findOne.mockResolvedValue({
        id: 55,
        documentId: 'usr_doc_10',
      });

      // 3. Course lookup succeeds with existing users
      mockDbQueries['api::course.course'].findOne.mockResolvedValue({
        id: 77,
        documentId: 'crs_doc_20',
        users_permissions_users: [{ id: 12 }, { id: 34 }],
      });

      // 4. Course update and Log creation mock
      mockDbQueries['api::course.course'].update.mockResolvedValue({});
      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].create.mockResolvedValue({
        id: 1,
        purchaseId: 'bm_pur_100',
        strapiUserId: 'usr_doc_10',
        courseId: 'crs_doc_20',
        status: 'processed',
      });

      const result = await byeMoneyPurchaseService.confirmPurchase(payload, { strapiInstance: mockStrapi });

      expect(result.httpStatus).toBe(200);
      expect(result.response).toEqual({
        success: true,
        purchaseId: 'bm_pur_100',
        status: 'granted',
        message: 'Course access granted successfully',
      });

      // Verify course update added user 55 without dropping 12 and 34
      expect(mockDbQueries['api::course.course'].update).toHaveBeenCalledWith({
        where: { id: 77 },
        data: {
          users_permissions_users: [12, 34, 55],
        },
      });

      // Verify user update added course 77
      expect(mockDbQueries['plugin::users-permissions.user'].update).toHaveBeenCalledWith({
        where: { id: 55 },
        data: {
          courses: [77],
        },
      });

      // Verify log entry was created with processed status
      expect(mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].create).toHaveBeenCalledWith({
        data: {
          purchaseId: 'bm_pur_100',
          strapiUserId: 'usr_doc_10',
          courseId: 'crs_doc_20',
          status: 'processed',
        },
      });
    });
  });

  describe('Many-to-Many Relationship Bidirectional Synchronization', () => {
    it('should reflect course addition on both Course and User models and merge without duplicates', async () => {
      const payload = {
        purchaseId: 'bm_pur_m2m_1',
        strapiUserId: 'usr_doc_m2m',
        courseId: 'crs_doc_m2m',
      };

      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne.mockResolvedValue(null);

      // User has pre-existing course with ID 99
      mockDbQueries['plugin::users-permissions.user'].findOne.mockResolvedValue({
        id: 50,
        documentId: 'usr_doc_m2m',
        courses: [{ id: 99 }],
      });

      // Course has pre-existing user with ID 10 and 2 chapters
      mockDbQueries['api::course.course'].findOne.mockResolvedValue({
        id: 80,
        documentId: 'crs_doc_m2m',
        users_permissions_users: [{ id: 10 }],
        chapters: [{ id: 101, title: 'Chapter 1' }, { id: 102, title: 'Chapter 2' }],
      });

      mockDbQueries['api::course.course'].update.mockResolvedValue({});
      mockDbQueries['plugin::users-permissions.user'].update.mockResolvedValue({});
      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].create.mockResolvedValue({
        id: 2,
        purchaseId: 'bm_pur_m2m_1',
        strapiUserId: 'usr_doc_m2m',
        courseId: 'crs_doc_m2m',
        status: 'processed',
      });

      const result = await byeMoneyPurchaseService.confirmPurchase(payload, { strapiInstance: mockStrapi });

      expect(result.httpStatus).toBe(200);
      expect(result.response.status).toBe('granted');

      // 1. Course side: user 50 added to existing user 10
      expect(mockDbQueries['api::course.course'].update).toHaveBeenCalledWith({
        where: { id: 80 },
        data: {
          users_permissions_users: [10, 50],
        },
      });

      // 2. User side: course 80 added to existing course 99, and chapter IDs [101, 102] added to enrolledChapters
      expect(mockDbQueries['plugin::users-permissions.user'].update).toHaveBeenCalledWith({
        where: { id: 50 },
        data: {
          courses: [99, 80],
          enrolledChapters: [101, 102],
        },
      });
    });

    it('should support looking up user and course by numeric ID when documentId does not match', async () => {
      const payload = {
        purchaseId: 'bm_pur_num_1',
        strapiUserId: '555',
        courseId: '888',
      };

      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne.mockResolvedValue(null);

      // User lookup by documentId returns null, then numeric lookup succeeds
      mockDbQueries['plugin::users-permissions.user'].findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 555,
          documentId: 'doc_u_555',
          courses: [],
        });

      // Course lookup by documentId returns null, then numeric lookup succeeds
      mockDbQueries['api::course.course'].findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 888,
          documentId: 'doc_c_888',
          users_permissions_users: [],
        });

      mockDbQueries['api::course.course'].update.mockResolvedValue({});
      mockDbQueries['plugin::users-permissions.user'].update.mockResolvedValue({});
      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].create.mockResolvedValue({
        id: 3,
        purchaseId: 'bm_pur_num_1',
        strapiUserId: '555',
        courseId: '888',
        status: 'processed',
      });

      const result = await byeMoneyPurchaseService.confirmPurchase(payload, { strapiInstance: mockStrapi });

      expect(result.httpStatus).toBe(200);
      expect(result.response.status).toBe('granted');

      expect(mockDbQueries['api::course.course'].update).toHaveBeenCalledWith({
        where: { id: 888 },
        data: {
          users_permissions_users: [555],
        },
      });

      expect(mockDbQueries['plugin::users-permissions.user'].update).toHaveBeenCalledWith({
        where: { id: 555 },
        data: {
          courses: [888],
        },
      });
    });
  });

  describe('Idempotent Replay (Same purchaseId, user, and course)', () => {
    it('should be a no-op and return 200 with status "already_granted"', async () => {
      const payload = {
        purchaseId: 'bm_pur_100',
        strapiUserId: 'usr_doc_10',
        courseId: 'crs_doc_20',
      };

      // Existing log entry matches exactly
      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne.mockResolvedValue({
        id: 1,
        purchaseId: 'bm_pur_100',
        strapiUserId: 'usr_doc_10',
        courseId: 'crs_doc_20',
        status: 'processed',
      });

      const result = await byeMoneyPurchaseService.confirmPurchase(payload, { strapiInstance: mockStrapi });

      expect(result.httpStatus).toBe(200);
      expect(result.response).toEqual({
        success: true,
        purchaseId: 'bm_pur_100',
        status: 'already_granted',
        message: 'Purchase was already processed and access granted',
      });

      // Ensure no database writes or lookups were performed
      expect(mockDbQueries['plugin::users-permissions.user'].findOne).not.toHaveBeenCalled();
      expect(mockDbQueries['api::course.course'].findOne).not.toHaveBeenCalled();
      expect(mockDbQueries['api::course.course'].update).not.toHaveBeenCalled();
      expect(mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].create).not.toHaveBeenCalled();
    });
  });

  describe('Conflict Detection', () => {
    it('should return 409 conflict when purchaseId exists with different strapiUserId', async () => {
      const payload = {
        purchaseId: 'bm_pur_100',
        strapiUserId: 'usr_doc_DIFFERENT',
        courseId: 'crs_doc_20',
      };

      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne.mockResolvedValue({
        id: 1,
        purchaseId: 'bm_pur_100',
        strapiUserId: 'usr_doc_10',
        courseId: 'crs_doc_20',
        status: 'processed',
      });

      const result = await byeMoneyPurchaseService.confirmPurchase(payload, { strapiInstance: mockStrapi });

      expect(result.httpStatus).toBe(409);
      expect(result.response).toEqual({
        success: false,
        purchaseId: 'bm_pur_100',
        status: 'conflict',
        message: expect.stringContaining('different strapiUserId or courseId'),
      });

      expect(mockDbQueries['api::course.course'].update).not.toHaveBeenCalled();
    });

    it('should return 409 conflict when purchaseId exists with different courseId', async () => {
      const payload = {
        purchaseId: 'bm_pur_100',
        strapiUserId: 'usr_doc_10',
        courseId: 'crs_doc_DIFFERENT',
      };

      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne.mockResolvedValue({
        id: 1,
        purchaseId: 'bm_pur_100',
        strapiUserId: 'usr_doc_10',
        courseId: 'crs_doc_20',
        status: 'processed',
      });

      const result = await byeMoneyPurchaseService.confirmPurchase(payload, { strapiInstance: mockStrapi });

      expect(result.httpStatus).toBe(409);
      expect(result.response.status).toBe('conflict');
      expect(mockDbQueries['api::course.course'].update).not.toHaveBeenCalled();
    });
  });

  describe('Entity Existence Checks (User or Course Not Found)', () => {
    it('should return 404 when user is not found by strapiUserId and not create log', async () => {
      const payload = {
        purchaseId: 'bm_pur_200',
        strapiUserId: 'non_existent_user',
        courseId: 'crs_doc_20',
      };

      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne.mockResolvedValue(null);
      mockDbQueries['plugin::users-permissions.user'].findOne.mockResolvedValue(null);

      const result = await byeMoneyPurchaseService.confirmPurchase(payload, { strapiInstance: mockStrapi });

      expect(result.httpStatus).toBe(404);
      expect(result.response).toEqual({
        success: false,
        purchaseId: 'bm_pur_200',
        status: 'error',
        message: 'User not found with strapiUserId: non_existent_user',
      });

      expect(mockDbQueries['api::course.course'].update).not.toHaveBeenCalled();
      expect(mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].create).not.toHaveBeenCalled();
    });

    it('should return 404 when course is not found by courseId and not create log', async () => {
      const payload = {
        purchaseId: 'bm_pur_300',
        strapiUserId: 'usr_doc_10',
        courseId: 'non_existent_course',
      };

      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne.mockResolvedValue(null);
      mockDbQueries['plugin::users-permissions.user'].findOne.mockResolvedValue({
        id: 55,
        documentId: 'usr_doc_10',
      });
      mockDbQueries['api::course.course'].findOne.mockResolvedValue(null);

      const result = await byeMoneyPurchaseService.confirmPurchase(payload, { strapiInstance: mockStrapi });

      expect(result.httpStatus).toBe(404);
      expect(result.response).toEqual({
        success: false,
        purchaseId: 'bm_pur_300',
        status: 'error',
        message: 'Course not found with courseId: non_existent_course',
      });

      expect(mockDbQueries['api::course.course'].update).not.toHaveBeenCalled();
      expect(mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].create).not.toHaveBeenCalled();
    });
  });

  describe('Integration Controller HTTP Handling', () => {
    it('should set ctx.status and ctx.body correctly on success', async () => {
      const ctx = {
        request: {
          body: {
            purchaseId: 'bm_ctrl_1',
            strapiUserId: 'u1',
            courseId: 'c1',
          },
        },
      };

      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne.mockResolvedValue({
        purchaseId: 'bm_ctrl_1',
        strapiUserId: 'u1',
        courseId: 'c1',
        status: 'processed',
      });

      await integrationController.confirmPurchase(ctx);

      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual({
        success: true,
        purchaseId: 'bm_ctrl_1',
        status: 'already_granted',
        message: 'Purchase was already processed and access granted',
      });
    });

    it('should return 500 status on unexpected exceptions', async () => {
      const ctx = {
        request: {
          body: {
            purchaseId: 'bm_ctrl_err',
            strapiUserId: 'u1',
            courseId: 'c1',
          },
        },
      };

      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne.mockRejectedValue(
        new Error('Database disk error')
      );

      await integrationController.confirmPurchase(ctx);

      expect(ctx.status).toBe(500);
      expect(ctx.body).toEqual({
        success: false,
        purchaseId: 'bm_ctrl_err',
        status: 'error',
        message: 'Internal server error while processing purchase confirmation',
      });
    });
  });

  describe('Service-to-Service Auth Policy (is-service-authenticated)', () => {
    const isServiceAuthenticated = require('../../../src/policies/is-service-authenticated');

    const originalEnv = process.env.BYEMONEY_SERVICE_KEY;

    afterEach(() => {
      if (originalEnv) {
        process.env.BYEMONEY_SERVICE_KEY = originalEnv;
      } else {
        delete process.env.BYEMONEY_SERVICE_KEY;
      }
    });

    it('should allow request when X-Service-Key matches BYEMONEY_SERVICE_KEY', () => {
      process.env.BYEMONEY_SERVICE_KEY = 'secret_webhook_key_123';
      const policyCtx = {
        get: jest.fn((header) => (header === 'x-service-key' ? 'secret_webhook_key_123' : null)),
      };

      expect(isServiceAuthenticated(policyCtx)).toBe(true);
    });

    it('should throw UnauthorizedError when X-Service-Key is missing or invalid', () => {
      process.env.BYEMONEY_SERVICE_KEY = 'secret_webhook_key_123';
      const policyCtx = {
        get: jest.fn(() => 'wrong_key'),
      };

      expect(() => isServiceAuthenticated(policyCtx)).toThrow('Unauthorized');
    });

    it('should throw UnauthorizedError when BYEMONEY_SERVICE_KEY is not configured', () => {
      delete process.env.BYEMONEY_SERVICE_KEY;
      const policyCtx = {
        get: jest.fn(() => 'any_key'),
      };

      expect(() => isServiceAuthenticated(policyCtx)).toThrow('Service key is not configured');
    });
  });

  describe('Race Condition & Narrow Constraint Error Handling', () => {
    it('should return 200 already_granted on concurrent race when winning record matches exact user/course', async () => {
      const payload = {
        purchaseId: 'bm_pur_race_1',
        strapiUserId: 'usr_doc_10',
        courseId: 'crs_doc_20',
      };

      // Initial check returns null (neither request saw it yet)
      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne
        .mockResolvedValueOnce(null) // step 2 initial check
        .mockResolvedValueOnce({    // step 6 raceCheck after create fails
          id: 99,
          purchaseId: 'bm_pur_race_1',
          strapiUserId: 'usr_doc_10',
          courseId: 'crs_doc_20',
          status: 'processed',
        });

      mockDbQueries['plugin::users-permissions.user'].findOne.mockResolvedValue({
        id: 10,
        documentId: 'usr_doc_10',
      });

      mockDbQueries['api::course.course'].findOne.mockResolvedValue({
        id: 20,
        documentId: 'crs_doc_20',
        users_permissions_users: [],
      });

      // DB throws unique constraint error on create
      const uniqueError = new Error('UNIQUE constraint failed: byemoney_purchase_logs.purchase_id');
      uniqueError.code = 'SQLITE_CONSTRAINT';
      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].create.mockRejectedValue(uniqueError);

      const result = await byeMoneyPurchaseService.confirmPurchase(payload, { strapiInstance: mockStrapi });

      expect(result.httpStatus).toBe(200);
      expect(result.response).toEqual({
        success: true,
        purchaseId: 'bm_pur_race_1',
        status: 'already_granted',
        message: 'Purchase was already processed and access granted',
      });
    });

    it('should return 409 conflict on concurrent race when winning record has DIFFERENT strapiUserId', async () => {
      const payload = {
        purchaseId: 'bm_pur_race_2',
        strapiUserId: 'usr_doc_A',
        courseId: 'crs_doc_20',
      };

      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne
        .mockResolvedValueOnce(null) // step 2
        .mockResolvedValueOnce({    // step 6 raceCheck
          id: 100,
          purchaseId: 'bm_pur_race_2',
          strapiUserId: 'usr_doc_B', // Different user won the race
          courseId: 'crs_doc_20',
          status: 'processed',
        });

      mockDbQueries['plugin::users-permissions.user'].findOne.mockResolvedValue({
        id: 10,
        documentId: 'usr_doc_A',
      });

      mockDbQueries['api::course.course'].findOne.mockResolvedValue({
        id: 20,
        documentId: 'crs_doc_20',
        users_permissions_users: [],
      });

      const pgUniqueError = new Error('duplicate key value violates unique constraint "purchase_id_unique"');
      pgUniqueError.code = '23505';
      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].create.mockRejectedValue(pgUniqueError);

      const result = await byeMoneyPurchaseService.confirmPurchase(payload, { strapiInstance: mockStrapi });

      expect(result.httpStatus).toBe(409);
      expect(result.response).toEqual({
        success: false,
        purchaseId: 'bm_pur_race_2',
        status: 'conflict',
        message: 'Conflict: purchaseId already exists with different strapiUserId or courseId',
      });
    });

    it('should return 409 conflict on concurrent race when winning record has DIFFERENT courseId', async () => {
      const payload = {
        purchaseId: 'bm_pur_race_3',
        strapiUserId: 'usr_doc_10',
        courseId: 'crs_doc_A',
      };

      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 101,
          purchaseId: 'bm_pur_race_3',
          strapiUserId: 'usr_doc_10',
          courseId: 'crs_doc_B', // Different course won the race
          status: 'processed',
        });

      mockDbQueries['plugin::users-permissions.user'].findOne.mockResolvedValue({
        id: 10,
        documentId: 'usr_doc_10',
      });

      mockDbQueries['api::course.course'].findOne.mockResolvedValue({
        id: 20,
        documentId: 'crs_doc_A',
        users_permissions_users: [],
      });

      const mysqlUniqueError = new Error("Duplicate entry 'bm_pur_race_3' for key 'purchaseId'");
      mysqlUniqueError.errno = 1062;
      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].create.mockRejectedValue(mysqlUniqueError);

      const result = await byeMoneyPurchaseService.confirmPurchase(payload, { strapiInstance: mockStrapi });

      expect(result.httpStatus).toBe(409);
      expect(result.response.status).toBe('conflict');
    });

    it('should propagate non-unique database errors (e.g. connection lost) without treating as race condition', async () => {
      const payload = {
        purchaseId: 'bm_pur_net_err',
        strapiUserId: 'usr_doc_10',
        courseId: 'crs_doc_20',
      };

      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne.mockResolvedValueOnce(null);

      mockDbQueries['plugin::users-permissions.user'].findOne.mockResolvedValue({
        id: 10,
        documentId: 'usr_doc_10',
      });

      mockDbQueries['api::course.course'].findOne.mockResolvedValue({
        id: 20,
        documentId: 'crs_doc_20',
        users_permissions_users: [],
      });

      const networkError = new Error('Connection terminated unexpectedly');
      networkError.code = 'ECONNRESET';
      mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].create.mockRejectedValue(networkError);

      await expect(
        byeMoneyPurchaseService.confirmPurchase(payload, { strapiInstance: mockStrapi })
      ).rejects.toThrow('Connection terminated unexpectedly');

      // Ensure findOne was NOT called a second time because non-unique error threw immediately
      expect(mockDbQueries['api::byemoney-purchase-log.byemoney-purchase-log'].findOne).toHaveBeenCalledTimes(1);
    });

    it('should accurately detect various unique constraint error signatures', () => {
      const { isUniqueConstraintError } = byeMoneyPurchaseService;

      expect(isUniqueConstraintError({ code: '23505' })).toBe(true);
      expect(isUniqueConstraintError({ code: 'SQLITE_CONSTRAINT' })).toBe(true);
      expect(isUniqueConstraintError({ code: 'ER_DUP_ENTRY' })).toBe(true);
      expect(isUniqueConstraintError({ errno: 1062 })).toBe(true);
      expect(isUniqueConstraintError({ message: 'unique constraint "idx" violated' })).toBe(true);
      expect(isUniqueConstraintError({ message: 'duplicate key value' })).toBe(true);
      expect(isUniqueConstraintError({ name: 'ValidationError', message: 'purchaseId must be unique' })).toBe(true);

      // Non-unique errors should return false
      expect(isUniqueConstraintError(null)).toBe(false);
      expect(isUniqueConstraintError(new Error('Connection timeout'))).toBe(false);
      expect(isUniqueConstraintError({ code: 'ECONNREFUSED' })).toBe(false);
      expect(isUniqueConstraintError({ code: '42P01', message: 'relation does not exist' })).toBe(false);
    });
  });
});

