import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

interface Commodity {
  id: string;
  shortName: string;
  name: string;
  grade: string;
  cas: string;
}

interface PortalLogic {
  COMPANY_INFO: {
    name: string;
    address: string;
    phone: string;
    whatsapp: string;
    email: string;
    webUrlSlot: string;
    paymentTerms: string;
  };
  COMMODITIES: readonly Commodity[];
  calculateLogisticsEstimate: (tonnage: number | string, packaging: string) => string;
  validateQuoteInput: (input: {
    buyerName?: string;
    businessName?: string;
    deliveryLocation?: string;
    selectedProductIds?: string[];
    includeFullCatalog?: boolean;
    tonnage?: number | string;
  }) => { valid: boolean; errors: Record<string, string> };
  formatQuoteEmail: (input: {
    buyerName?: string;
    businessName?: string;
    deliveryLocation?: string;
    buyerPhone?: string;
    selectedProductIds?: string[];
    includeFullCatalog?: boolean;
    tonnage?: number | string;
    packaging?: string;
    notes?: string;
  }) => {
    to: string;
    subject: string;
    body: string;
    mailtoHref: string;
    clipboardText: string;
  };
}

function loadPortalLogicFromIndexHtml(): PortalLogic {
  const htmlPath = path.resolve(process.cwd(), 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const match = html.match(/<script id="portal-logic">([\s\S]*?)<\/script>/);
  assert.ok(match && match[1], 'index.html must contain the inline <script id="portal-logic"> block');

  const loader = new Function(`${match[1]}; return globalThis.__ANS_PORTAL_LOGIC__;`);
  return loader() as PortalLogic;
}

const logic = loadPortalLogicFromIndexHtml();

test('company metadata and required 3 commodities match specification', () => {
  assert.equal(logic.COMPANY_INFO.name, 'A & S Landscape Materials, Inc.');
  assert.equal(logic.COMPANY_INFO.email, 'Sales.ansmaterials@gmail.com');
  assert.equal(logic.COMPANY_INFO.address, '580 Jacoby Street, San Rafael, CA 94901');
  assert.equal(logic.COMPANY_INFO.phone, '+1 205-205-5600');
  assert.equal(logic.COMPANY_INFO.whatsapp, '+1 (985) 299-8282');
  assert.equal(logic.COMPANY_INFO.webUrlSlot, '[Web URL — Add Later]');

  assert.equal(logic.COMMODITIES.length, 3);
  const gradesAndCas = logic.COMMODITIES.map((c) => `${c.grade}:${c.cas}`);
  assert.deepEqual(gradesAndCas, [
    '46-0-0:57-13-6',
    '18-46-0:7783-28-0',
    '0-0-60:7447-40-7',
  ]);
});

test('calculateLogisticsEstimate computes hopper truckloads and 2,000 lb totes accurately', () => {
  assert.equal(
    logic.calculateLogisticsEstimate(25, 'Bulk Hopper Truck'),
    'Est. 1 Bulk Hopper truckload (~25 short tons/load)'
  );
  assert.equal(
    logic.calculateLogisticsEstimate(50, 'Bulk Hopper Truck'),
    'Est. 2 Bulk Hopper truckloads (~25 short tons/load)'
  );
  assert.equal(
    logic.calculateLogisticsEstimate(48, '2,000 lb Totes (Super Sacks)'),
    '48 × 2,000 lb Super Sacks (est. 3 flatbed loads)'
  );
  assert.match(logic.calculateLogisticsEstimate(0, 'Bulk Hopper Truck'), /Enter valid short tonnage/);
});

test('validateQuoteInput rejects missing required fields without silent fallbacks', () => {
  const emptyResult = logic.validateQuoteInput({
    buyerName: '',
    businessName: '   ',
    deliveryLocation: '',
    selectedProductIds: [],
    includeFullCatalog: false,
    tonnage: 0,
  });

  assert.equal(emptyResult.valid, false);
  assert.ok(emptyResult.errors.buyerName);
  assert.ok(emptyResult.errors.businessName);
  assert.ok(emptyResult.errors.deliveryLocation);
  assert.ok(emptyResult.errors.products);
  assert.ok(emptyResult.errors.tonnage);

  const validResult = logic.validateQuoteInput({
    buyerName: 'Elena Vasquez',
    businessName: 'Sonoma Valley Growers LLC',
    deliveryLocation: 'Sonoma County, CA',
    selectedProductIds: ['urea-46-0-0', 'potash-0-0-60'],
    includeFullCatalog: false,
    tonnage: 48,
  });

  assert.equal(validResult.valid, true);
  assert.deepEqual(validResult.errors, {});
});

test('formatQuoteEmail generates complete mailto URI and formatted RFQ body', () => {
  const result = logic.formatQuoteEmail({
    buyerName: 'Elena Vasquez',
    businessName: 'Sonoma Valley Growers LLC',
    deliveryLocation: 'Sonoma County, CA',
    buyerPhone: '(707) 555-0144',
    selectedProductIds: ['urea-46-0-0', 'dap-18-46-0'],
    includeFullCatalog: true,
    tonnage: 50,
    packaging: '2,000 lb Totes (Super Sacks)',
    notes: 'Deliveries preferred before April 15.',
  });

  assert.equal(result.to, 'Sales.ansmaterials@gmail.com');
  assert.match(result.subject, /46-0-0, 18-46-0/);
  assert.match(result.subject, /50 Short Tons/);
  assert.match(result.subject, /Sonoma Valley Growers LLC/);

  assert.match(result.body, /Granular Urea \(46-0-0 \| CAS 57-13-6\)/);
  assert.match(result.body, /Diammonium Phosphate \(DAP\) \(18-46-0 \| CAS 7783-28-0\)/);
  assert.match(result.body, /2,000 lb Totes \(Super Sacks\)/);
  assert.match(result.body, /20% Deposit \/ 80% Upon Bill of Lading Inspection at Farm Gate/);
  assert.match(result.body, /CDFA-Licensed Distribution Partner Fulfillment/);
  assert.match(result.body, /Deliveries preferred before April 15\./);

  assert.ok(result.mailtoHref.startsWith('mailto:Sales.ansmaterials@gmail.com?subject='));
  assert.ok(result.mailtoHref.includes('&body='));
  assert.ok(result.clipboardText.includes(`To: ${result.to}`));
  assert.ok(result.clipboardText.includes(`Subject: ${result.subject}`));
});
