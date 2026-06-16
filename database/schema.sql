-- Splitly Database Schema & Seed Data
-- Designed for MySQL Workbench and production deployment

CREATE DATABASE IF NOT EXISTS splitly;
USE splitly;

-- Disable foreign key checks to allow drops of existing tables
SET FOREIGN_KEY_CHECKS = 0;

-- Drop existing tables in reverse order of foreign keys to allow clean re-runs
DROP TABLE IF EXISTS ingestion_anomalies;
DROP TABLE IF EXISTS import_reports;
DROP TABLE IF EXISTS settlements;
DROP TABLE IF EXISTS expense_splits;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS group_memberships;
DROP TABLE IF EXISTS `groups`;
DROP TABLE IF EXISTS users;

-- 1. Users Table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Groups Table
CREATE TABLE `groups` (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Group Memberships Table (Temporal Source of Truth)
CREATE TABLE group_memberships (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_id INT NOT NULL,
    user_id INT NOT NULL,
    joined_at DATE NOT NULL,
    left_at DATE NULL,
    FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_group_user (group_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Expenses Table
CREATE TABLE expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_id INT NOT NULL,
    paid_by_id INT NOT NULL,
    amount DECIMAL(15, 4) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    exchange_rate DECIMAL(15, 6) NOT NULL DEFAULT 1.000000,
    description VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
    FOREIGN KEY (paid_by_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Expense Splits Table (Relational split breakdowns)
CREATE TABLE expense_splits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    expense_id INT NOT NULL,
    user_id INT NOT NULL,
    amount_owed DECIMAL(15, 4) NOT NULL,
    split_type VARCHAR(50) NOT NULL DEFAULT 'equal', -- equal, percentage, exact, share
    split_value DECIMAL(15, 4) NULL, -- stores percentage value or share count
    FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Settlements Table (Direct debt paybacks)
CREATE TABLE settlements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_id INT NOT NULL,
    payer_id INT NOT NULL,
    payee_id INT NOT NULL,
    amount DECIMAL(15, 4) NOT NULL,
    date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
    FOREIGN KEY (payer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (payee_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Import Reports Table
CREATE TABLE import_reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    run_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_rows INT NOT NULL,
    clean_rows INT NOT NULL,
    anomalies_found INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. Ingestion Anomalies Table
CREATE TABLE ingestion_anomalies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    import_report_id INT NOT NULL,
    raw_csv_row_data TEXT NOT NULL,
    detected_issue_type VARCHAR(255) NOT NULL,
    resolution_status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, MUTATED, REJECTED, RESOLVED
    fixed_json_payload JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (import_report_id) REFERENCES import_reports(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ==========================================
-- SEED DATA
-- ==========================================

-- Seed Core Group
INSERT INTO `groups` (id, name) VALUES (1, 'Flat 221B');

-- Seed Users (with bcrypt hashes for 'password123')
INSERT INTO users (id, name, email, password_hash) VALUES
(1, 'Aisha', 'aisha@splitly.com', '$2b$10$v7g9fepk.0mU.P.hIqZcNuL1c6uN8Kk7G0fM8eLp1YJ.4B0p3H91C'),
(2, 'Rohan', 'rohan@splitly.com', '$2b$10$v7g9fepk.0mU.P.hIqZcNuL1c6uN8Kk7G0fM8eLp1YJ.4B0p3H91C'),
(3, 'Priya', 'priya@splitly.com', '$2b$10$v7g9fepk.0mU.P.hIqZcNuL1c6uN8Kk7G0fM8eLp1YJ.4B0p3H91C'),
(4, 'Meera', 'meera@splitly.com', '$2b$10$v7g9fepk.0mU.P.hIqZcNuL1c6uN8Kk7G0fM8eLp1YJ.4B0p3H91C'),
(5, 'Sam', 'sam@splitly.com', '$2b$10$v7g9fepk.0mU.P.hIqZcNuL1c6uN8Kk7G0fM8eLp1YJ.4B0p3H91C'),
(6, 'Dev', 'dev@splitly.com', '$2b$10$v7g9fepk.0mU.P.hIqZcNuL1c6uN8Kk7G0fM8eLp1YJ.4B0p3H91C'),
(7, 'Kabir', 'kabir@splitly.com', '$2b$10$v7g9fepk.0mU.P.hIqZcNuL1c6uN8Kk7G0fM8eLp1YJ.4B0p3H91C');

-- Seed Group Memberships (Temporal mapping)
-- Aisha, Rohan, Priya, Dev, Kabir joined at the start
-- Meera left March 31, 2026
-- Sam joined April 15, 2026 (mid-April)
INSERT INTO group_memberships (group_id, user_id, joined_at, left_at) VALUES
(1, 1, '2026-01-01', NULL),          -- Aisha
(1, 2, '2026-01-01', NULL),          -- Rohan
(1, 3, '2026-01-01', NULL),          -- Priya
(1, 4, '2026-01-01', '2026-03-31'),  -- Meera (leaves March 31)
(1, 5, '2026-04-15', NULL),          -- Sam (joins April 15)
(1, 6, '2026-01-01', NULL),          -- Dev (trip participant / guest)
(1, 7, '2026-01-01', NULL);          -- Kabir

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;
