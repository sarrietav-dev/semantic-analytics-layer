CREATE TABLE companies (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE departments (
  id BIGINT PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL
);

CREATE TABLE employees (
  id BIGINT PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  department_id BIGINT NOT NULL REFERENCES departments(id),
  name TEXT NOT NULL,
  hire_date DATE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE performance_reviews (
  id BIGINT PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  company_id BIGINT NOT NULL,
  period DATE NOT NULL,
  score NUMERIC(4,2) NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE attendance (
  id BIGINT PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  company_id BIGINT NOT NULL,
  date DATE NOT NULL,
  present BOOLEAN NOT NULL
);
