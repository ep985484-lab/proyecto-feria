/**
 * API Centralizada - Sistema de Gestión Escolar (SGE)
 * Backend ligero para centralizar datos sin modificar frontend existente
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const joi = require('joi');
const winston = require('winston');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const moment = require('moment');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'sge-secret-key-2024';
const DB_PATH = path.join(__dirname, 'data', 'sge.db');

// Configuración de Winston
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'sge-api' },
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

// Crear directorio de datos si no existe
const dataDir = path.dirname(DB_PATH);

// Asegurar que fs.existsSync y fs.mkdirSync estén disponibles
if (typeof fs.existsSync === 'function' && typeof fs.mkdirSync === 'function') {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
} else {
    // Fallback: intentar con require('fs').promises o crear directorio con try-catch
    try {
        const fsSync = require('fs');
        if (!fsSync.existsSync(dataDir)) {
            fsSync.mkdirSync(dataDir, { recursive: true });
        }
    } catch (err) {
        console.warn('No se pudo crear directorio de datos:', err.message);
    }
}

// Inicializar base de datos SQLite
let db;
try {
    db = new Database(DB_PATH);
    logger.info('Conectado a SQLite en:', DB_PATH);
    initializeDatabase();
} catch (err) {
    logger.error('Error conectando a la base de datos:', err);
}

// Middleware
app.use(helmet());
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configuración de Multer para uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'uploads'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Esquemas de validación
const schemas = {
    user: joi.object({
        username: joi.string().alphanum().min(3).max(20).required(),
        password: joi.string().min(6).max(100).required(),
        name: joi.string().min(2).max(50).required(),
        role: joi.string().valid('admin', 'direccion', 'docente', 'psicologa', 'cafeteria', 'comedor', 'enfermeria', 'odontologia', 'papeleria').required()
    }),
    
    excuse: joi.object({
        studentName: joi.string().min(2).max(50).required(),
        course: joi.string().min(1).max(30).required(),
        psychologistUsername: joi.string().required(),
        reason: joi.string().min(10).max(500).required(),
        type: joi.string().valid('medica', 'personal', 'familiar', 'otra').required(),
        professorUsername: joi.string().required()
    }),
    
    message: joi.object({
        sender: joi.string().required(),
        recipient: joi.string().required(),
        subject: joi.string().min(3).max(100).required(),
        content: joi.string().min(10).max(1000).required()
    }),
    
    attendance: joi.object({
        course: joi.string().required(),
        date: joi.string().isoDate().required(),
        presentStudents: joi.array().items(joi.string()).required(),
        absentStudents: joi.array().items(joi.string()).required(),
        totalStudents: joi.number().min(1).required(),
        professorUsername: joi.string().required()
    }),
    
    uniformReservation: joi.object({
        customer_name: joi.string().min(2).max(50).required(),
        customer_last_name: joi.string().min(2).max(50).required(),
        customer_cedula: joi.string().min(7).max(20).required(),
        customer_phone: joi.string().min(9).max(20).required(),
        customer_email: joi.string().email().optional(),
        customer_grade: joi.string().valid('4to', '5to', '6to').required(),
        items: joi.array().items(
            joi.object({
                productId: joi.number().required(),
                name: joi.string().required(),
                size: joi.string().required(),
                quantity: joi.number().min(1).required(),
                price: joi.number().min(0).required()
            })
        ).min(1).required(),
        total: joi.number().min(0).required()
    }),
    
    uniformProduct: joi.object({
        name: joi.string().min(2).max(100).required(),
        description: joi.string().min(5).max(500).required(),
        category: joi.string().valid('poloche', 'pantalon', 'deporte', 'conjunto').required(),
        price: joi.number().min(0).required(),
        image: joi.string().optional(),
        grade: joi.string().required(),
        gender: joi.string().valid('M', 'F', 'U').required(),
        sizes: joi.object().required(),
        stock: joi.number().min(0).default(0)
    })
};

// Middleware de autenticación
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token requerido' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido' });
        }
        req.user = user;
        next();
    });
};

// Middleware de logging de requests
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, { 
        ip: req.ip, 
        userAgent: req.get('User-Agent') 
    });
    next();
});

// Función para inicializar la base de datos
function initializeDatabase() {
    // Crear tablas si no existen
    const tables = [
        `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS excuses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            studentName TEXT NOT NULL,
            course TEXT NOT NULL,
            psychologistUsername TEXT NOT NULL,
            reason TEXT NOT NULL,
            type TEXT NOT NULL,
            professorUsername TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT NOT NULL,
            recipient TEXT NOT NULL,
            subject TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT DEFAULT 'sent',
            readStatus INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course TEXT NOT NULL,
            date TEXT NOT NULL,
            presentStudents TEXT NOT NULL,
            absentStudents TEXT NOT NULL,
            totalStudents INTEGER NOT NULL,
            professorUsername TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            originalName TEXT NOT NULL,
            mimetype TEXT NOT NULL,
            size INTEGER NOT NULL,
            path TEXT NOT NULL,
            uploadedBy TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            generatedBy TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS uniform_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            category TEXT NOT NULL,
            price REAL NOT NULL,
            image TEXT,
            grade TEXT NOT NULL,
            gender TEXT NOT NULL,
            sizes TEXT NOT NULL,
            stock INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS uniform_reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            customer_name TEXT NOT NULL,
            customer_last_name TEXT NOT NULL,
            customer_cedula TEXT NOT NULL,
            customer_phone TEXT NOT NULL,
            customer_email TEXT,
            customer_grade TEXT NOT NULL,
            items TEXT NOT NULL,
            total REAL NOT NULL,
            status TEXT DEFAULT 'PENDIENTE',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS uniform_reservation_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reservation_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            product_name TEXT NOT NULL,
            size TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY (reservation_id) REFERENCES uniform_reservations (id)
        )`
    ];

    tables.forEach(table => {
        try {
            db.exec(table);
        } catch (err) {
            logger.error('Error creando tabla:', err);
        }
    });

    // Insertar usuarios iniciales si no existen
    const initialUsers = [
        ['admin', 'Administrador Principal', 'admin'],
        ['admin2', 'Administrador Secundario', 'admin'],
        ['admin3', 'Administrador Terciario', 'admin'],
        ['direccion', 'Director General', 'direccion'],
        ['prof_starling', 'Prof. Starling Batista', 'docente'],
        ['prof_belkis', 'Prof. Belkis Martínez', 'docente'],
        ['psi_maria', 'María Gómez', 'psicologa'],
        ['psi_ana', 'Ana Martínez', 'psicologa'],
        ['psi_laura', 'Laura Pérez', 'psicologa']
    ];

    const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, password, name, role) VALUES (?, ?, ?, ?)');
    
    initialUsers.forEach(([username, name, role]) => {
        const hashedPassword = bcrypt.hashSync('password123', 10);
        insertUser.run(username, hashedPassword, name, role);
    });

    // Insertar productos iniciales de uniformes si no existen
    const initialUniformProducts = [
        ['Poloche Blanco 4to/5to', 'Poloche blanco para niño / masculino', 'poloche', 450, 'img/blanco.m.jpeg', '4to/5to', 'M', JSON.stringify({S:10,M:8,L:5,XL:3}), 15],
        ['Poloche Blanco 4to/5to', 'Poloche blanco para niña / femenino', 'poloche', 450, 'img/blanco.f.jpeg', '4to/5to', 'F', JSON.stringify({S:8,M:10,L:6,XL:2}), 12],
        ['Poloche Azul con Rojo 6to', 'Poloche azul especial para grado 6to', 'poloche', 450, '', '6to', 'M', JSON.stringify({S:6,M:9,L:5,XL:3}), 10],
        ['Poloche Azul 6to', 'Poloche azul especial para grado 6to', 'poloche', 450, 'img/sola1.jpeg', '6to', 'F', JSON.stringify({S:7,M:8,L:4,XL:2}), 8],
        ['Pantalón Azul 4to/5to/6to', 'Pantalón azul marino para niño', 'pantalon', 550, 'img/pantalon.m.jpeg', '4to/5to/6to', 'M', JSON.stringify({S:6,M:10,L:8,XL:4}), 12],
        ['Pantalón Azul 4to/5to', 'Pantalón azul marino para femenina', 'pantalon', 550, 'img/pantalon.f.jpeg', '4to/5to/6to', 'F', JSON.stringify({S:8,M:7,L:5,XL:2}), 10],
        ['Pantalón Deportivo 6to', 'Pantalón deportivo para Masculino y Femenino', 'deporte', 550, 'img/deporte.m.jpeg', '6to', 'M', JSON.stringify({S:5,M:9,L:7,XL:3}), 10],
        ['Pantalón Deportivo 4to/5to', 'Pantalón deportivo para Feminina y Masculino', 'deporte', 550, 'img/deporte.f.jpeg', '4to/5to', 'F', JSON.stringify({S:6,M:8,L:5,XL:2}), 10],
        ['Uniforme Deportivo Completo 4to/5to', 'Camiseta y pantalón deportivo completo', 'conjunto', 850, 'img/conjunto.jpeg', '4to/5to', 'U', JSON.stringify({S:5,M:8,L:6,XL:2}), 15],
        ['Uniforme Deportivo Completo 4to/5to/6to', 'Camiseta y pantalón deportivo completo', 'conjunto', 850, 'img/conjunto2.jpeg', '4to/5to/6to', 'U', JSON.stringify({S:4,M:6,L:5,XL:1}), 12]
    ];

    const insertProduct = db.prepare('INSERT OR IGNORE INTO uniform_products (name, description, category, price, image, grade, gender, sizes, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    
    initialUniformProducts.forEach(([name, description, category, price, image, grade, gender, sizes, stock]) => {
        insertProduct.run(name, description, category, price, image, grade, gender, sizes, stock);
    });

    logger.info('Base de datos inicializada');
}

// Rutas de autenticación
app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
        }

        db.get(
            'SELECT * FROM users WHERE username = ?',
            [username],
            (err, user) => {
                if (err) {
                    logger.error('Error en login:', err);
                    return res.status(500).json({ error: 'Error del servidor' });
                }

                if (!user) {
                    return res.status(401).json({ error: 'Credenciales inválidas' });
                }

                const passwordMatch = bcrypt.compareSync(password, user.password);
                if (!passwordMatch) {
                    return res.status(401).json({ error: 'Credenciales inválidas' });
                }

                const token = jwt.sign(
                    { userId: user.id, username: user.username, role: user.role, name: user.name },
                    JWT_SECRET,
                    { expiresIn: '24h' }
                );

                logger.info(`Usuario ${username} inició sesión`);
                
                res.json({
                    success: true,
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        name: user.name,
                        role: user.role
                    }
                });
            }
        );
    } catch (error) {
        logger.error('Error en login:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

app.post('/api/auth/validate', authenticateToken, (req, res) => {
    res.json({ valid: true, user: req.user });
});

// Rutas de excusas
app.get('/api/excuses', authenticateToken, (req, res) => {
    const { role, username } = req.user;
    
    let query = 'SELECT * FROM excuses';
    let params = [];
    
    if (role === 'docente') {
        query += ' WHERE professorUsername = ?';
        params = [username];
    } else if (role === 'psicologa') {
        query += ' WHERE psychologistUsername = ?';
        params = [username];
    }
    
    query += ' ORDER BY createdAt DESC';
    
    db.all(query, params, (err, rows) => {
        if (err) {
            logger.error('Error obteniendo excusas:', err);
            return res.status(500).json({ error: 'Error del servidor' });
        }
        
        res.json(rows);
    });
});

app.post('/api/excuses', authenticateToken, (req, res) => {
    try {
        const { error, value } = schemas.excuse.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { studentName, course, psychologistUsername, reason, type } = value;
        const professorUsername = req.user.username;

        db.run(
            'INSERT INTO excuses (studentName, course, psychologistUsername, reason, type, professorUsername) VALUES (?, ?, ?, ?, ?, ?)',
            [studentName, course, psychologistUsername, reason, type, professorUsername],
            function(err) {
                if (err) {
                    logger.error('Error creando excusa:', err);
                    return res.status(500).json({ error: 'Error del servidor' });
                }
                
                logger.info(`Excusa creada por ${professorUsername} para ${studentName}`);
                res.json({ success: true, id: this.lastID });
            }
        );
    } catch (error) {
        logger.error('Error creando excusa:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Rutas de mensajes
app.get('/api/messages', authenticateToken, (req, res) => {
    const { role, username } = req.user;
    
    let query = 'SELECT * FROM messages';
    let params = [];
    
    if (role === 'docente') {
        query += ' WHERE sender = ? OR recipient = ?';
        params = [username, username];
    } else if (role === 'psicologa') {
        query += ' WHERE sender = ? OR recipient = ?';
        params = [username, username];
    }
    
    query += ' ORDER BY createdAt DESC';
    
    db.all(query, params, (err, rows) => {
        if (err) {
            logger.error('Error obteniendo mensajes:', err);
            return res.status(500).json({ error: 'Error del servidor' });
        }
        
        res.json(rows);
    });
});

app.post('/api/messages', authenticateToken, (req, res) => {
    try {
        const { error, value } = schemas.message.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { sender, recipient, subject, content } = value;

        db.run(
            'INSERT INTO messages (sender, recipient, subject, content) VALUES (?, ?, ?, ?)',
            [sender, recipient, subject, content],
            function(err) {
                if (err) {
                    logger.error('Error creando mensaje:', err);
                    return res.status(500).json({ error: 'Error del servidor' });
                }
                
                logger.info(`Mensaje de ${sender} para ${recipient}`);
                res.json({ success: true, id: this.lastID });
            }
        );
    } catch (error) {
        logger.error('Error creando mensaje:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Rutas de asistencia
app.get('/api/attendance', authenticateToken, (req, res) => {
    const { username } = req.user;
    
    db.all(
        'SELECT * FROM attendance WHERE professorUsername = ? ORDER BY date DESC',
        [username],
        (err, rows) => {
            if (err) {
                logger.error('Error obteniendo asistencia:', err);
                return res.status(500).json({ error: 'Error del servidor' });
            }
            
            res.json(rows);
        }
    );
});

app.post('/api/attendance', authenticateToken, (req, res) => {
    try {
        const { error, value } = schemas.attendance.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { course, date, presentStudents, absentStudents, totalStudents } = value;
        const professorUsername = req.user.username;

        db.run(
            'INSERT INTO attendance (course, date, presentStudents, absentStudents, totalStudents, professorUsername) VALUES (?, ?, ?, ?, ?, ?)',
            [course, date, JSON.stringify(presentStudents), JSON.stringify(absentStudents), totalStudents, professorUsername],
            function(err) {
                if (err) {
                    logger.error('Error creando asistencia:', err);
                    return res.status(500).json({ error: 'Error del servidor' });
                }
                
                logger.info(`Asistencia registrada por ${professorUsername} para ${course}`);
                res.json({ success: true, id: this.lastID });
            }
        );
    } catch (error) {
        logger.error('Error creando asistencia:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Rutas de archivos
app.post('/api/files/upload', authenticateToken, upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se proporcionó archivo' });
        }

        const fileData = {
            filename: req.file.filename,
            originalName: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            path: req.file.path,
            uploadedBy: req.user.username
        };

        db.run(
            'INSERT INTO files (filename, originalName, mimetype, size, path, uploadedBy) VALUES (?, ?, ?, ?, ?, ?)',
            [fileData.filename, fileData.originalName, fileData.mimetype, fileData.size, fileData.path, fileData.uploadedBy],
            function(err) {
                if (err) {
                    logger.error('Error guardando archivo:', err);
                    return res.status(500).json({ error: 'Error del servidor' });
                }
                
                logger.info(`Archivo subido por ${req.user.username}: ${fileData.originalName}`);
                res.json({ success: true, file: fileData });
            }
        );
    } catch (error) {
        logger.error('Error subiendo archivo:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

app.get('/api/files', authenticateToken, (req, res) => {
    db.all(
        'SELECT * FROM files ORDER BY createdAt DESC',
        [],
        (err, rows) => {
            if (err) {
                logger.error('Error obteniendo archivos:', err);
                return res.status(500).json({ error: 'Error del servidor' });
            }
            
            res.json(rows);
        }
    );
});

// Rutas de usuarios
app.get('/api/users', authenticateToken, (req, res) => {
    db.all(
        'SELECT id, username, name, role, created_at FROM users ORDER BY created_at',
        [],
        (err, rows) => {
            if (err) {
                logger.error('Error obteniendo usuarios:', err);
                return res.status(500).json({ error: 'Error del servidor' });
            }
            
            res.json(rows);
        }
    );
});

// Rutas de sincronización (compatibilidad con frontend)
app.get('/api/sync/excuses', authenticateToken, (req, res) => {
    const { role, username } = req.user;
    
    let query = 'SELECT * FROM excuses';
    let params = [];
    
    if (role === 'docente') {
        query += ' WHERE professorUsername = ?';
        params = [username];
    } else if (role === 'psicologa') {
        query += ' WHERE psychologistUsername = ?';
        params = [username];
    }
    
    db.all(query, params, (err, rows) => {
        if (err) {
            logger.error('Error sincronizando excusas:', err);
            return res.status(500).json({ error: 'Error del servidor' });
        }
        
        // Formato compatible con frontend
        const formattedData = rows.map(excuse => ({
            id: excuse.id,
            estudiante: excuse.studentName,
            curso: excuse.course,
            motivo: excuse.reason,
            tipo: excuse.type,
            psychologistUsername: excuse.psychologistUsername,
            profesor: excuse.professorUsername,
            timestamp: excuse.createdAt,
            status: excuse.status
        }));
        
        res.json(formattedData);
    });
});

app.get('/api/sync/messages', authenticateToken, (req, res) => {
    const { role, username } = req.user;
    
    let query = 'SELECT * FROM messages';
    let params = [];
    
    if (role === 'docente') {
        query += ' WHERE sender = ? OR recipient = ?';
        params = [username, username];
    } else if (role === 'psicologa') {
        query += ' WHERE sender = ? OR recipient = ?';
        params = [username, username];
    }
    
    query += ' ORDER BY createdAt DESC';
    
    db.all(query, params, (err, rows) => {
        if (err) {
            logger.error('Error sincronizando mensajes:', err);
            return res.status(500).json({ error: 'Error del servidor' });
        }
        
        // Formato compatible con frontend
        const formattedData = rows.map(message => ({
            id: message.id,
            de: message.sender,
            para: message.recipient,
            asunto: message.subject,
            contenido: message.content,
            timestamp: message.createdAt,
            status: message.status,
            leido: message.readStatus
        }));
        
        res.json(formattedData);
    });
});

// ====== ENDPOINTS DE UNIFORMES ======

// Obtener productos de uniformes (público)
app.get('/api/uniforms/products', (req, res) => {
    const { category, grade, gender, search } = req.query;
    
    let query = 'SELECT * FROM uniform_products WHERE status = "active"';
    let params = [];
    
    if (category && category !== 'all') {
        query += ' AND category = ?';
        params.push(category);
    }
    
    if (grade && grade !== 'all') {
        query += ' AND grade LIKE ?';
        params.push(`%${grade}%`);
    }
    
    if (gender && gender !== 'all') {
        query += ' AND (gender = ? OR gender = "U")';
        params.push(gender);
    }
    
    if (search) {
        query += ' AND (name LIKE ? OR description LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ' ORDER BY category, name';
    
    db.all(query, params, (err, rows) => {
        if (err) {
            logger.error('Error obteniendo productos:', err);
            return res.status(500).json({ error: 'Error del servidor' });
        }
        
        // Formatear productos para el frontend
        const formattedProducts = rows.map(product => ({
            id: product.id,
            name: product.name,
            desc: product.description,
            category: product.category,
            price: product.price,
            img: product.image,
            grade: product.grade.split('/'),
            gender: product.gender,
            sizes: JSON.parse(product.sizes || '{}'),
            stock: product.stock
        }));
        
        res.json(formattedProducts);
    });
});

// Crear reserva de uniformes (público)
app.post('/api/uniforms/reservations', (req, res) => {
    try {
        const { error, value } = schemas.uniformReservation.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }
        
        const reservationData = value;
        const code = 'EB-' + Math.random().toString(36).substr(2, 6).toUpperCase();
        
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            // Insertar reserva principal
            db.run(
                `INSERT INTO uniform_reservations 
                (code, customer_name, customer_last_name, customer_cedula, customer_phone, customer_email, customer_grade, items, total) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    code,
                    reservationData.customer_name,
                    reservationData.customer_last_name,
                    reservationData.customer_cedula,
                    reservationData.customer_phone,
                    reservationData.customer_email || null,
                    reservationData.customer_grade,
                    JSON.stringify(reservationData.items),
                    reservationData.total
                ],
                function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        logger.error('Error creando reserva:', err);
                        return res.status(500).json({ error: 'Error del servidor' });
                    }
                    
                    const reservationId = this.lastID;
                    
                    // Insertar items de la reserva
                    const insertItem = db.prepare(
                        'INSERT INTO uniform_reservation_items (reservation_id, product_id, product_name, size, quantity, price) VALUES (?, ?, ?, ?, ?, ?)'
                    );
                    
                    let itemsInserted = 0;
                    const totalItems = reservationData.items.length;
                    
                    reservationData.items.forEach(item => {
                        insertItem.run(
                            [reservationId, item.productId, item.name, item.size, item.quantity, item.price],
                            (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    logger.error('Error insertando item:', err);
                                    return res.status(500).json({ error: 'Error del servidor' });
                                }
                                
                                itemsInserted++;
                                if (itemsInserted === totalItems) {
                                    insertItem.finalize();
                                    db.run('COMMIT');
                                    
                                    // Responder con éxito
                                    res.status(201).json({
                                        message: 'Reserva creada exitosamente',
                                        reservation: {
                                            id: reservationId,
                                            code: code,
                                            customer: {
                                                name: reservationData.customer_name,
                                                lastName: reservationData.customer_last_name,
                                                cedula: reservationData.customer_cedula,
                                                phone: reservationData.customer_phone,
                                                email: reservationData.customer_email,
                                                grade: reservationData.customer_grade
                                            },
                                            items: reservationData.items,
                                            total: reservationData.total,
                                            status: 'PENDIENTE'
                                        }
                                    });
                                    
                                    logger.info(`Reserva creada: ${code} - ${reservationData.customer_name} ${reservationData.customer_last_name}`);
                                }
                            }
                        );
                    });
                }
            );
        });
        
    } catch (error) {
        logger.error('Error en reserva:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener reservas (admin)
app.get('/api/uniforms/reservations', authenticateToken, (req, res) => {
    const { status, limit = 50, offset = 0 } = req.query;
    
    let query = 'SELECT * FROM uniform_reservations';
    let params = [];
    
    if (status && status !== 'all') {
        query += ' WHERE status = ?';
        params.push(status);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    db.all(query, params, (err, rows) => {
        if (err) {
            logger.error('Error obteniendo reservas:', err);
            return res.status(500).json({ error: 'Error del servidor' });
        }
        
        // Obtener items para cada reserva
        const reservationsWithItems = rows.map(reservation => {
            return new Promise((resolve) => {
                db.all(
                    'SELECT * FROM uniform_reservation_items WHERE reservation_id = ?',
                    [reservation.id],
                    (err, items) => {
                        resolve({
                            ...reservation,
                            items: items || [],
                            items_json: JSON.parse(reservation.items || '[]')
                        });
                    }
                );
            });
        });
        
        Promise.all(reservationsWithItems).then(formattedReservations => {
            res.json(formattedReservations);
        });
    });
});

// Actualizar estado de reserva (admin)
app.patch('/api/uniforms/reservations/:id/status', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!['PENDIENTE', 'CONFIRMADA', 'ENTREGADA', 'CANCELADA'].includes(status)) {
        return res.status(400).json({ error: 'Estado inválido' });
    }
    
    db.run(
        'UPDATE uniform_reservations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, id],
        function(err) {
            if (err) {
                logger.error('Error actualizando reserva:', err);
                return res.status(500).json({ error: 'Error del servidor' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Reserva no encontrada' });
            }
            
            res.json({ message: 'Estado actualizado exitosamente', status });
            logger.info(`Reserva ${id} actualizada a ${status}`);
        }
    );
});

// Obtener estadísticas de uniformes (admin)
app.get('/api/uniforms/stats', authenticateToken, (req, res) => {
    const queries = {
        totalReservations: 'SELECT COUNT(*) as count FROM uniform_reservations',
        pendingReservations: 'SELECT COUNT(*) as count FROM uniform_reservations WHERE status = "PENDIENTE"',
        totalRevenue: 'SELECT SUM(total) as total FROM uniform_reservations WHERE status != "CANCELADA"',
        lowStockProducts: 'SELECT COUNT(*) as count FROM uniform_products WHERE stock <= 5',
        topProducts: `
            SELECT uri.product_name, SUM(uri.quantity) as total_sold 
            FROM uniform_reservation_items uri 
            JOIN uniform_reservations ur ON uri.reservation_id = ur.id 
            WHERE ur.status != "CANCELADA" 
            GROUP BY uri.product_name 
            ORDER BY total_sold DESC 
            LIMIT 5
        `
    };
    
    const stats = {};
    let completed = 0;
    const totalQueries = Object.keys(queries).length;
    
    Object.entries(queries).forEach(([key, query]) => {
        db.all(query, (err, rows) => {
            if (err) {
                logger.error(`Error en estadística ${key}:`, err);
                stats[key] = err;
            } else {
                if (key === 'topProducts') {
                    stats[key] = rows;
                } else {
                    stats[key] = rows[0];
                }
            }
            
            completed++;
            if (completed === totalQueries) {
                res.json(stats);
            }
        });
    });
});

// Endpoint de salud
app.get('/api/health', (req, res) => {
    db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: 'connected',
            users: row ? row.count : 0
        });
    });
});

// Manejo de errores 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado' });
});

// Manejo de errores globales
app.use((err, req, res, next) => {
    logger.error('Error no manejado:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// Iniciar servidor
app.listen(PORT, () => {
    logger.info(`🚀 API SGE corriendo en puerto ${PORT}`);
    logger.info(`📊 Base de datos: ${DB_PATH}`);
    logger.info(`🌐 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
