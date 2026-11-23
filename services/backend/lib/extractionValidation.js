const IDENTIFIER_RULES = [
  { pattern: /(?:^|[._])pan$|pan(?:_number)?$/i, code: 'invalid_pan', test: /^[A-Z]{5}[0-9]{4}[A-Z]$/i, message: 'PAN does not match the expected format.' },
  { pattern: /gstin/i, code: 'invalid_gstin', test: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/i, message: 'GSTIN does not match the expected format.' },
  { pattern: /(?:^|[._])tan$|tan$/i, code: 'invalid_tan', test: /^[A-Z]{4}[0-9]{5}[A-Z]$/i, message: 'TAN does not match the expected format.' },
  { pattern: /ifsc/i, code: 'invalid_ifsc', test: /^[A-Z]{4}0[A-Z0-9]{6}$/i, message: 'IFSC does not match the expected format.' },
  { pattern: /hsn/i, code: 'invalid_hsn', test: /^[0-9]{4,8}$/, message: 'HSN code should contain 4 to 8 digits.' },
];

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
  const date = new Date(`${value}T00:00:00Z`);
  return date.toISOString().slice(0, 10) === value;
}

function validateExtractedDataQuality(data, category) {
  const warnings = [];

  function add(path, code, message) {
    warnings.push({ path, code, message, status: 'review' });
  }

  function walk(value, path) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;

    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (typeof child === 'string' && child.trim()) {
        const rule = IDENTIFIER_RULES.find(candidate => candidate.pattern.test(key));
        if (rule && !rule.test.test(child.trim())) add(childPath, rule.code, rule.message);
        if (/(?:date|period_from|period_to|due_date)$/i.test(key) && !isValidIsoDate(child.trim())) {
          add(childPath, 'invalid_date', 'Date uses YYYY-MM-DD but is not a real calendar date.');
        }
      }
      if (typeof child === 'number' && !isFiniteNumber(child)) {
        add(childPath, 'non_finite_number', 'Financial or count value is not finite.');
      }
      walk(child, childPath);
    }
  }

  walk(data, '');

  if (!data || typeof data !== 'object') return warnings;

  // 1. GST Cross-Checks
  if (category === 'GST') {
    const taxable = data.taxable_value;
    const tax = data.total_gst;
    const total = data.grand_total;
    if ([taxable, tax, total].every(isFiniteNumber) && total + 1 < taxable + tax) {
      add('grand_total', 'gst_total_mismatch', 'Grand total is lower than taxable value plus total GST.');
    }
  }

  // 2. Form 16 Cross-Checks
  if (category === 'Form16') {
    const gross = data.gross_salary;
    const exempt = data.allowances_exempt_u_s_10 || 0;
    const stdDed = data.standard_deduction || 0;
    const profTax = data.professional_tax || 0;
    const salaryIncome = data.income_from_salary;

    if (isFiniteNumber(gross) && isFiniteNumber(salaryIncome) && isFiniteNumber(stdDed)) {
      const expectedSalaryIncome = gross - exempt - stdDed - profTax;
      if (Math.abs(salaryIncome - expectedSalaryIncome) > 50) {
        add('income_from_salary', 'form16_salary_math_mismatch', `Income from salary (${salaryIncome}) does not equal gross salary minus deductions (${expectedSalaryIncome}).`);
      }
    }

    const netTaxable = data.net_taxable_income ?? data.total_taxable_income;
    const sec80c = data.section_80c ?? data.ded_80c ?? 0;
    const sec80d = data.section_80d ?? data.ded_80d ?? 0;
    const otherDeductions = data.other_chapter_vi_a_total ?? 0;
    const totalDeductions = sec80c + sec80d + otherDeductions;

    if (isFiniteNumber(salaryIncome) && isFiniteNumber(netTaxable) && totalDeductions > 0) {
      if (netTaxable > salaryIncome) {
        add('net_taxable_income', 'form16_taxable_exceeds_salary', 'Net taxable income exceeds salary income despite chapter VI-A deductions.');
      }
    }

    if (Array.isArray(data.quarterly_tds) && data.quarterly_tds.length > 0) {
      const totalQuarterlyTds = data.quarterly_tds.reduce((sum, q) => sum + (Number(q?.tds_deducted) || 0), 0);
      const reportedTds = data.total_tds ?? data.tds_deducted_total ?? data.tax_deducted;
      if (isFiniteNumber(reportedTds) && totalQuarterlyTds > 0 && Math.abs(totalQuarterlyTds - reportedTds) > 10) {
        add('total_tds', 'form16_quarterly_tds_mismatch', `Total TDS (${reportedTds}) does not match sum of quarterly TDS records (${totalQuarterlyTds}).`);
      }
    }
  }

  // 3. ITR / IncomeTax Cross-Checks
  if (['IncomeTax', 'ITR1', 'ITR2'].includes(category)) {
    const grossTotal = data.gross_total_income;
    const salary = data.salary_gross || 0;
    const house = data.house_property_income || 0;
    const other = data.other_sources_income || 0;
    const stcg = data.short_term_capital_gains || 0;
    const ltcg = data.long_term_capital_gains || 0;

    if (isFiniteNumber(grossTotal) && [salary, house, other].some(v => v !== 0)) {
      const expectedGross = salary + house + other + stcg + ltcg;
      if (Math.abs(grossTotal - expectedGross) > 50) {
        add('gross_total_income', 'itr_gross_income_mismatch', `Gross total income (${grossTotal}) does not match sum of income heads (${expectedGross}).`);
      }
    }

    const totalIncome = data.total_income ?? data.taxable_income;
    const deductions = data.total_deductions_chapter_vi_a ?? (
      (data.ded_80c || data.deductions_80c || 0) +
      (data.ded_80d || data.deductions_80d || 0) +
      (data.ded_80ccd_1b || 0) +
      (data.ded_80g || 0) +
      (data.ded_other || data.other_deductions || 0)
    );

    if (isFiniteNumber(grossTotal) && isFiniteNumber(totalIncome) && deductions > 0) {
      const expectedTotal = Math.max(0, grossTotal - deductions);
      if (Math.abs(totalIncome - expectedTotal) > 50) {
        add('total_income', 'itr_total_income_mismatch', `Total income (${totalIncome}) does not match gross total income minus deductions (${expectedTotal}).`);
      }
    }
  }

  return warnings;
}

module.exports = { validateExtractedDataQuality };
