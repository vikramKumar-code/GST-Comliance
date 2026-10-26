const ApiError = require('../utils/apiError');

/**
 * In-memory Mock Provider Engine for FinAGG GSP APIs
 * Follows Section 9 (Mock mode specification) of docs/ARCHITECTURE.md.
 */
class FinaggMock {
  /**
   * Check for simulated provider downtime (GSTIN starting with '99' or test switch)
   */
  static _checkProviderDown(gstin, options = {}) {
    if (options.simulateDown || (gstin && gstin.startsWith('99'))) {
      throw ApiError.providerDown('FinAGG mock: GST system or provider temporarily unavailable.');
    }
  }

  /**
   * Search taxpayer business details by GSTIN
   * - GSTIN starting with '99' simulates PROVIDER_DOWN
   * - GSTIN ending with '0' simulates not found
   * - Any other valid GSTIN returns fake taxpayer
   */
  static async searchGstin(gstin) {
    FinaggMock._checkProviderDown(gstin);

    if (gstin.endsWith('0')) {
      throw ApiError.invalidGstin('Taxpayer GSTIN not found or status cancelled.');
    }

    return {
      legalName: 'Demo Traders Pvt Ltd',
      tradeName: 'Demo Traders',
      status: 'Active',
      taxpayerType: 'Regular',
      state: 'Maharashtra',
      registrationDate: '2018-07-01',
      verified: true
    };
  }

  /**
   * Request OTP from GST System
   * - GSTIN starting with '99' simulates PROVIDER_DOWN
   * - OTPREQUEST returns { status_cd: "1" } per real sample
   */
  static async requestOtp(gstin, username) {
    FinaggMock._checkProviderDown(gstin);

    return {
      status_cd: '1'
    };
  }

  /**
   * Verify OTP with GST System
   * - OTP '123456' succeeds and returns { status_cd: "1", auth_token: <fake>, expiry: "", sek: "" }
   * - Any other OTP throws OTP_INVALID
   */
  static async verifyOtp(gstin, username, otp) {
    FinaggMock._checkProviderDown(gstin);

    if (otp !== '123456') {
      throw ApiError.otpInvalid('Invalid or expired OTP. (Hint: In mock mode, use OTP 123456)');
    }

    const mockGstToken = `mock_gst_token_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    return {
      status_cd: '1',
      auth_token: mockGstToken,
      expiry: '',
      sek: '',
      token: mockGstToken
    };
  }

  /**
   * Refresh GST AuthToken (Mock)
   */
  static async refreshToken(gstin, username, token) {
    FinaggMock._checkProviderDown(gstin);
    if (!token) {
      throw ApiError.validationError('Auth token is required to refresh session.');
    }
    const refreshedToken = `mock_gst_token_refreshed_${Date.now()}`;
    return {
      status_cd: '1',
      auth_token: refreshedToken,
      expiry: '',
      sek: '',
      token: refreshedToken
    };
  }

  /**
   * Request EVC OTP (Mock)
   */
  static async requestEvcOtp(gstin, username, pan, formType, token) {
    FinaggMock._checkProviderDown(gstin);
    if (!token) {
      throw ApiError.validationError('Auth token is required for EVC OTP request.');
    }
    return {
      status_cd: '1',
      message: 'OTP has been dispatched successfully to the registered mobile/email on GST portal.'
    };
  }

  /**
   * Fetch returns summary (available periods and filing status)
   */
  static async getReturnsSummary(gstin, requestedPeriod, options = {}) {
    FinaggMock._checkProviderDown(gstin, options);

    return {
      gstin,
      availablePeriods: [
        { period: '092026', financialYear: '2026-27', gstr1: 'FILED', gstr2b: 'GENERATED', gstr3b: 'FILED' },
        { period: '082026', financialYear: '2026-27', gstr1: 'FILED', gstr2b: 'GENERATED', gstr3b: 'FILED' },
        { period: '072026', financialYear: '2026-27', gstr1: 'FILED', gstr2b: 'GENERATED', gstr3b: 'FILED' },
        { period: '062026', financialYear: '2026-27', gstr1: 'FILED', gstr2b: 'GENERATED', gstr3b: 'FILED' }
      ]
    };
  }

  /**
   * Fetch raw provider-like return data for GSTR1, GSTR2B, or GSTR3B
   */
  static async getReturn(type, gstin, period, options = {}) {
    FinaggMock._checkProviderDown(gstin, options);

    // GSTR-2B for period 012022 simulates RET2B1023 (DATA_NOT_AVAILABLE) per doc/gstr2b-error-RET2B1023.json
    if (type.toUpperCase() === 'GSTR2B' && period === '012022') {
      throw ApiError.dataNotAvailable('Data for this period is not available yet. Try another month.');
    }

    switch (type.toUpperCase()) {
      case 'GSTR1':
        // mock shape, not verified
        return {
          gstin,
          period,
          source: 'FINAGG_MOCK_RAW_GSTR1',
          sections: [
            {
              table: '4A, 4B, 4C, 6B, 6C - B2B Invoices',
              taxable_value: 450000,
              igst_amount: 45000,
              cgst_amount: 18000,
              sgst_amount: 18000,
              cess_amount: 0
            },
            {
              table: '5A, 5B - B2C (Large) Invoices',
              taxable_value: 80000,
              igst_amount: 14400,
              cgst_amount: 0,
              sgst_amount: 0,
              cess_amount: 0
            },
            {
              table: '7 - B2C (Others)',
              taxable_value: 60000,
              igst_amount: 0,
              cgst_amount: 5400,
              sgst_amount: 5400,
              cess_amount: 0
            },
            {
              table: '6A - Exports Supplies',
              taxable_value: 50000,
              igst_amount: 9000,
              cgst_amount: 0,
              sgst_amount: 0,
              cess_amount: 0
            }
          ]
        };

      case 'GSTR2B':
        // mock shape, not verified
        return {
          gstin,
          period,
          source: 'FINAGG_MOCK_RAW_GSTR2B',
          itc_categories: [
            {
              heading: 'Part A: Inward Supplies from Registered Persons (B2B)',
              taxable_value: 360000,
              igst_amount: 36000,
              cgst_amount: 14400,
              sgst_amount: 14400,
              cess_amount: 0
            },
            {
              heading: 'Part B: Inward Supplies via E-Commerce (9(5))',
              taxable_value: 20000,
              igst_amount: 0,
              cgst_amount: 1800,
              sgst_amount: 1800,
              cess_amount: 0
            },
            {
              heading: 'Part C: Import of Goods (IMPG)',
              taxable_value: 40000,
              igst_amount: 7200,
              cgst_amount: 0,
              sgst_amount: 0,
              cess_amount: 0
            }
          ],
          summary: {
            itc_available: 75600,
            itc_claimed: 75600
          }
        };

      case 'GSTR3B':
        // mock shape, not verified
        return {
          gstin,
          period,
          source: 'FINAGG_MOCK_RAW_GSTR3B',
          outward_supplies: {
            taxable_value: 640000,
            igst_amount: 68400,
            cgst_amount: 23400,
            sgst_amount: 23400,
            cess_amount: 0
          },
          inward_supplies: {
            taxable_value: 420000,
            igst_amount: 43200,
            cgst_amount: 16200,
            sgst_amount: 16200,
            cess_amount: 0
          },
          eligible_itc: {
            total_itc_available: 75600,
            total_itc_claimed: 75600
          },
          tax_payable: 39600
        };

      default:
        throw ApiError.validationError(`Unsupported return type: ${type}`);
    }
  }
}

module.exports = FinaggMock;
