INSERT INTO companies (id, name) VALUES
  (1, 'Acme'),
  (2, 'Other Corp');

INSERT INTO departments (id, company_id, name) VALUES
  (10, 1, 'Engineering'),
  (11, 1, 'Sales'),
  (12, 1, 'Empty Department'),
  (20, 2, 'Engineering');

INSERT INTO employees (id, company_id, department_id, name, hire_date, active) VALUES
  (100, 1, 10, 'Alice', '2023-01-10', TRUE),
  (101, 1, 10, 'Bob', '2024-06-01', TRUE),
  (102, 1, 11, 'Carol', '2025-02-15', TRUE),
  (103, 1, 11, 'Dan', '2022-03-01', FALSE),
  (104, 1, 12, 'Eve', '2026-01-01', TRUE),
  (200, 2, 20, 'Mallory', '2020-01-01', TRUE);

INSERT INTO performance_reviews
  (id, employee_id, company_id, period, score, status)
VALUES
  (1000, 100, 1, '2025-02-15', 80.00, 'completed'),
  (1001, 100, 1, '2025-03-20', 90.00, 'completed'),
  (1002, 101, 1, '2025-03-25', 50.00, 'pending'),
  (1003, 101, 1, '2025-05-30', 70.00, 'completed'),
  (1004, 102, 1, '2025-08-15', 95.00, 'calibrated'),
  (1005, 102, 1, '2025-11-20', 98.00, 'completed'),
  (1006, 103, 1, '2024-06-30', 60.00, 'completed'),
  (2000, 200, 2, '2025-02-15', 1.00, 'completed'),
  (3000, 200, 1, '2025-02-15', 2.00, 'completed');

INSERT INTO attendance (id, employee_id, company_id, date, present) VALUES
  (1000, 100, 1, '2025-04-01', TRUE),
  (1001, 100, 1, '2025-04-02', FALSE),
  (1002, 101, 1, '2025-04-01', TRUE),
  (1003, 102, 1, '2025-05-01', TRUE),
  (1004, 102, 1, '2025-05-02', FALSE),
  (1005, 100, 1, '2025-06-01', TRUE),
  (2000, 200, 2, '2025-04-01', FALSE),
  (3000, 200, 1, '2025-04-01', FALSE);
