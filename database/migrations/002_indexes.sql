CREATE INDEX performance_reviews_company_period_status_idx
  ON performance_reviews (company_id, period, status);

CREATE INDEX performance_reviews_employee_idx
  ON performance_reviews (employee_id);

CREATE INDEX attendance_company_date_idx
  ON attendance (company_id, date);

CREATE INDEX attendance_employee_idx
  ON attendance (employee_id);

CREATE INDEX employees_company_department_idx
  ON employees (company_id, department_id);

CREATE INDEX employees_company_active_hire_date_idx
  ON employees (company_id, active, hire_date);

CREATE INDEX departments_company_name_idx
  ON departments (company_id, name);
