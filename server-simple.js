/**
 * API Simplificada - Sistema de Gestión Escolar (SGE)
 * Versión para pruebas con almacenamiento en memoria
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const joi = require('joi');
const winston = require('winston');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const moment = require('moment');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'sge-secret-key-2024';

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
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

// Almacenamiento en memoria
let memoryDB = {
    users: [],
    uniformProducts: [],
    uniformReservations: [],
    uniformReservationItems: [],
    calificaciones: [],
    estudiantes: []
};

// Middleware
app.use(helmet());
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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
    
    calificacion: joi.object({
        matricula: joi.string().pattern(/^\d{4,}$/).required(),
        nombre_estudiante: joi.string().min(5).max(100).required(),
        materia: joi.string().min(3).max(50).required(),
        nota: joi.number().min(0).max(100).precision(1).required(),
        trimestre: joi.string().valid('1', '2', '3', '4').required()
    }),
    
    consultaEstudiante: joi.object({
        matricula: joi.string().pattern(/^\d{4,}$/).required(),
        nombre_completo: joi.string().min(5).max(100).required(),
        token_estudiante: joi.string().min(10).required()
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

// Función para inicializar la base de datos en memoria
function initializeMemoryDB() {
    // Insertar usuarios iniciales
    const initialUsers = [
        { username: 'admin', name: 'Administrador Principal', role: 'admin' },
        { username: 'admin2', name: 'Administrador Secundario', role: 'admin' },
        { username: 'direccion', name: 'Director General', role: 'direccion' }
    ];

    initialUsers.forEach(user => {
        if (!memoryDB.users.find(u => u.username === user.username)) {
            const hashedPassword = bcrypt.hashSync('password123', 10);
            memoryDB.users.push({
                id: memoryDB.users.length + 1,
                ...user,
                password: hashedPassword,
                created_at: new Date().toISOString()
            });
        }
    });

    // Insertar productos iniciales de uniformes
    const initialUniformProducts = [
        { id: 1, name: "Poloche Blanco 4to/5to", description: "Poloche blanco para niño / masculino", category: "poloche", price: 450, image: "img/blanco.m.jpeg", grade: "4to/5to", gender: "M", sizes: {S:10,M:8,L:5,XL:3}, stock: 15 },
        { id: 2, name: "Poloche Blanco 4to/5to", description: "Poloche blanco para niña / femenino", category: "poloche", price: 450, image: "img/blanco.f.jpeg", grade: "4to/5to", gender: "F", sizes: {S:8,M:10,L:6,XL:2}, stock: 12 },
        { id: 3, name: "Poloche Azul 6to", description: "Poloche azul especial para grado 6to", category: "poloche", price: 450, image: "", grade: "6to", gender: "M", sizes: {S:6,M:9,L:5,XL:3}, stock: 10 },
        { id: 4, name: "Poloche Azul 6to", description: "Poloche azul especial para grado 6to", category: "poloche", price: 450, image: "img/sola1.jpeg", grade: "6to", gender: "F", sizes: {S:7,M:8,L:4,XL:2}, stock: 8 },
        { id: 5, name: "Pantalón Azul 4to/5to/6to", description: "Pantalón azul marino para niño", category: "pantalon", price: 550, image: "img/pantalon.m.jpeg", grade: "4to/5to/6to", gender: "M", sizes: {S:6,M:10,L:8,XL:4}, stock: 12 },
        { id: 6, name: "Pantalón Azul 4to/5to", description: "Pantalón azul marino para femenina", category: "pantalon", price: 550, image: "img/pantalon.f.jpeg", grade: "4to/5to/6to", gender: "F", sizes: {S:8,M:7,L:5,XL:2}, stock: 10 },
        { id: 7, name: "Pantalón Deportivo 6to", description: "Pantalón deportivo para Masculino y Femenino", category: "deporte", price: 550, image: "img/deporte.m.jpeg", grade: "6to", gender: "M", sizes: {S:5,M:9,L:7,XL:3}, stock: 10 },
        { id: 8, name: "Pantalón Deportivo 4to/5to", description: "Pantalón deportivo para Feminina y Masculino", category: "deporte", price: 550, image: "img/deporte.f.jpeg", grade: "4to/5to", gender: "F", sizes: {S:6,M:8,L:5,XL:2}, stock: 10 },
        { id: 9, name: "Uniforme Deportivo Completo 4to/5to", description: "Camiseta y pantalón deportivo completo", category: "conjunto", price: 850, image: "img/conjunto.jpeg", grade: "4to/5to", gender: "U", sizes: {S:5,M:8,L:6,XL:2}, stock: 15 },
        { id: 10, name: "Uniforme Deportivo Completo 4to/5to/6to", description: "Camiseta y pantalón deportivo completo", category: "conjunto", price: 850, image: "img/conjunto2.jpeg", grade: "4to/5to/6to", gender: "U", sizes: {S:4,M:6,L:5,XL:1}, stock: 12 }
    ];

    initialUniformProducts.forEach(product => {
        if (!memoryDB.uniformProducts.find(p => p.id === product.id)) {
            memoryDB.uniformProducts.push({
                ...product,
                status: 'active',
                created_at: new Date().toISOString()
            });
        }
    });

    // Insertar estudiantes de ejemplo con tokens únicos
    const initialEstudiantes = [
        { matricula: "2024001", nombre_completo: "Juan Pérez Rodríguez", grado: "4to", seccion: "A" },
        { matricula: "2024002", nombre_completo: "María González López", grado: "4to", seccion: "B" },
        { matricula: "2024003", nombre_completo: "Carlos Martínez Sánchez", grado: "5to", seccion: "A" },
        { matricula: "2024004", nombre_completo: "Ana Rodríguez Díaz", grado: "5to", seccion: "B" },
        { matricula: "2024005", nombre_completo: "Luis Hernández Torres", grado: "6to", seccion: "A" },
        { matricula: "2024006", nombre_completo: "Sofía López Castro", grado: "6to", seccion: "B" }
    ];

    initialEstudiantes.forEach(estudiante => {
        if (!memoryDB.estudiantes.find(e => e.matricula === estudiante.matricula)) {
            memoryDB.estudiantes.push({
                ...estudiante,
                token_acceso: crypto.randomBytes(32).toString('hex'),
                activo: 1,
                created_at: new Date().toISOString()
            });
        }
    });

    logger.info('Base de datos en memoria inicializada');
}

// Rutas de autenticación
app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
        }

        const user = memoryDB.users.find(u => u.username === username);

        if (!user) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const passwordMatch = bcrypt.compareSync(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const token = jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                role: user.role 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role
            }
        });

        logger.info(`Usuario ${username} inició sesión`);
    } catch (error) {
        logger.error('Error en login:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ====== ENDPOINTS DE UNIFORMES ======

// Obtener productos de uniformes (público)
app.get('/api/uniforms/products', (req, res) => {
    const { category, grade, gender, search } = req.query;
    
    let filtered = memoryDB.uniformProducts.filter(p => p.status === 'active');
    
    if (category && category !== 'all') {
        filtered = filtered.filter(product => product.category === category);
    }
    
    if (grade && grade !== 'all') {
        filtered = filtered.filter(product => product.grade.includes(grade));
    }
    
    if (gender && gender !== 'all') {
        filtered = filtered.filter(product => product.gender === gender || product.gender === 'U');
    }
    
    if (search) {
        filtered = filtered.filter(product => 
            product.name.toLowerCase().includes(search.toLowerCase()) || 
            product.description.toLowerCase().includes(search.toLowerCase())
        );
    }
    
    // Formatear productos para el frontend
    const formattedProducts = filtered.map(product => ({
        id: product.id,
        name: product.name,
        desc: product.description,
        category: product.category,
        price: product.price,
        img: product.image,
        grade: product.grade.split('/'),
        gender: product.gender,
        sizes: product.sizes,
        stock: Object.values(product.sizes).reduce((sum, stock) => sum + stock, 0)
    }));
    
    res.json(formattedProducts);
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
        
        const reservation = {
            id: memoryDB.uniformReservations.length + 1,
            code: code,
            customer_name: reservationData.customer_name,
            customer_last_name: reservationData.customer_last_name,
            customer_cedula: reservationData.customer_cedula,
            customer_phone: reservationData.customer_phone,
            customer_email: reservationData.customer_email,
            customer_grade: reservationData.customer_grade,
            items: JSON.stringify(reservationData.items),
            total: reservationData.total,
            status: 'PENDIENTE',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        memoryDB.uniformReservations.push(reservation);
        
        // Insertar items de la reserva
        reservationData.items.forEach(item => {
            memoryDB.uniformReservationItems.push({
                id: memoryDB.uniformReservationItems.length + 1,
                reservation_id: reservation.id,
                product_id: item.productId,
                product_name: item.name,
                size: item.size,
                quantity: item.quantity,
                price: item.price
            });
        });
        
        res.status(201).json({
            message: 'Reserva creada exitosamente',
            reservation: {
                id: reservation.id,
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
    } catch (error) {
        logger.error('Error en reserva:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener reservas (admin)
app.get('/api/uniforms/reservations', authenticateToken, (req, res) => {
    const { status, limit = 50, offset = 0 } = req.query;
    
    let filtered = memoryDB.uniformReservations;
    
    if (status && status !== 'all') {
        filtered = filtered.filter(reservation => reservation.status === status);
    }
    
    // Ordenar por fecha descendente
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    // Aplicar paginación
    const paginated = filtered.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    // Obtener items para cada reserva
    const reservationsWithItems = paginated.map(reservation => {
        const items = memoryDB.uniformReservationItems.filter(item => item.reservation_id === reservation.id);
        return {
            ...reservation,
            items: items,
            items_json: JSON.parse(reservation.items || '[]')
        };
    });
    
    res.json(reservationsWithItems);
});

// Actualizar estado de reserva (admin)
app.patch('/api/uniforms/reservations/:id/status', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!['PENDIENTE', 'CONFIRMADA', 'ENTREGADA', 'CANCELADA'].includes(status)) {
        return res.status(400).json({ error: 'Estado inválido' });
    }
    
    const reservationIndex = memoryDB.uniformReservations.findIndex(r => r.id == id);
    
    if (reservationIndex === -1) {
        return res.status(404).json({ error: 'Reserva no encontrada' });
    }
    
    memoryDB.uniformReservations[reservationIndex].status = status;
    memoryDB.uniformReservations[reservationIndex].updated_at = new Date().toISOString();
    
    res.json({ message: 'Estado actualizado exitosamente', status });
    logger.info(`Reserva ${id} actualizada a ${status}`);
});

// Endpoint de salud
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'memory',
        users: memoryDB.users.length,
        products: memoryDB.uniformProducts.length,
        reservations: memoryDB.uniformReservations.length,
        calificaciones: memoryDB.calificaciones.length,
        estudiantes: memoryDB.estudiantes.length
    });
});

// ====== ENDPOINTS DE CALIFICACIONES ======

// Crear nueva calificación (docente, requiere auth)
app.post('/api/calificaciones', authenticateToken, (req, res) => {
    try {
        const { error, value } = schemas.calificacion.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }
        
        const calificacionData = value;
        const profesor = req.user;
        
        // Verificar que el estudiante existe
        const estudiante = memoryDB.estudiantes.find(e => e.matricula === calificacionData.matricula);
        if (!estudiante) {
            return res.status(404).json({ error: 'Estudiante no encontrado' });
        }
        
        // Verificar si ya existe una calificación para esta materia, trimestre y estudiante
        const existente = memoryDB.calificaciones.find(c => 
            c.matricula === calificacionData.matricula &&
            c.materia === calificacionData.materia &&
            c.trimestre === calificacionData.trimestre
        );
        
        if (existente) {
            return res.status(400).json({ error: 'Ya existe una calificación para esta materia y trimestre' });
        }
        
        // Crear nueva calificación
        const nuevaCalificacion = {
            id: memoryDB.calificaciones.length + 1,
            matricula: calificacionData.matricula,
            nombre_estudiante: calificacionData.nombre_estudiante,
            materia: calificacionData.materia,
            nota: calificacionData.nota,
            trimestre: calificacionData.trimestre,
            profesor_id: profesor.id,
            profesor_nombre: profesor.name,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        // Insertar directamente en cache
        memoryDB.calificaciones.push(nuevaCalificacion);
        
        // Logging de la operación
        logger.info(`Calificación creada: ${calificacionData.materia} - ${calificacionData.matricula} - ${calificacionData.nota} por ${profesor.name}`);
        
        res.status(201).json({
            message: 'Calificación registrada exitosamente',
            calificacion: nuevaCalificacion
        });
        
    } catch (error) {
        logger.error('Error creando calificación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar calificación existente (docente, requiere auth)
app.put('/api/calificaciones/:id', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = schemas.calificacion.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }
        
        const calificacionData = value;
        const profesor = req.user;
        
        // Buscar calificación existente
        const index = memoryDB.calificaciones.findIndex(c => c.id == id);
        if (index === -1) {
            return res.status(404).json({ error: 'Calificación no encontrada' });
        }
        
        const calificacionExistente = memoryDB.calificaciones[index];
        
        // Verificar que el profesor sea el mismo que creó la calificación o sea admin
        if (calificacionExistente.profesor_id !== profesor.id && profesor.role !== 'admin') {
            return res.status(403).json({ error: 'No autorizado para modificar esta calificación' });
        }
        
        // Actualizar calificación
        const calificacionActualizada = {
            ...calificacionExistente,
            matricula: calificacionData.matricula,
            nombre_estudiante: calificacionData.nombre_estudiante,
            materia: calificacionData.materia,
            nota: calificacionData.nota,
            trimestre: calificacionData.trimestre,
            updated_at: new Date().toISOString()
        };
        
        memoryDB.calificaciones[index] = calificacionActualizada;
        
        // Logging de la operación
        logger.info(`Calificación actualizada: ${calificacionData.materia} - ${calificacionData.matricula} - ${calificacionData.nota} por ${profesor.name}`);
        
        res.json({
            message: 'Calificación actualizada exitosamente',
            calificacion: calificacionActualizada
        });
        
    } catch (error) {
        logger.error('Error actualizando calificación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener calificaciones de estudiante (público con validación)
app.get('/api/calificaciones/estudiante/:matricula', (req, res) => {
    try {
        const { matricula } = req.params;
        const { token_estudiante, nombre_completo } = req.query;
        
        // Validar parámetros
        const { error } = schemas.consultaEstudiante.validate({
            matricula,
            token_estudiante,
            nombre_completo
        });
        
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }
        
        // Verificar estudiante en base de datos
        const estudiante = memoryDB.estudiantes.find(e => 
            e.matricula === matricula && 
            e.token_acceso === token_estudiante &&
            e.nombre_completo.toLowerCase() === nombre_completo.toLowerCase() &&
            e.activo === 1
        );
        
        if (!estudiante) {
            return res.status(403).json({ error: 'Acceso denegado: credenciales inválidas' });
        }
        
        // Obtener calificaciones del estudiante
        const calificaciones = memoryDB.calificaciones.filter(c => c.matricula === matricula);
        
        // Agrupar por trimestre
        const calificacionesPorTrimestre = {};
        calificaciones.forEach(cal => {
            if (!calificacionesPorTrimestre[cal.trimestre]) {
                calificacionesPorTrimestre[cal.trimestre] = [];
            }
            calificacionesPorTrimestre[cal.trimestre].push({
                materia: cal.materia,
                nota: cal.nota,
                profesor: cal.profesor_nombre,
                fecha: cal.created_at
            });
        });
        
        res.json({
            estudiante: {
                matricula: estudiante.matricula,
                nombre: estudiante.nombre_completo,
                grado: estudiante.grado,
                seccion: estudiante.seccion
            },
            calificaciones: calificacionesPorTrimestre,
            total_calificaciones: calificaciones.length
        });
        
    } catch (error) {
        logger.error('Error consultando calificaciones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener calificaciones por matrícula (uso administrativo/docente, requiere auth)
app.get('/api/calificaciones/matricula/:matricula', authenticateToken, (req, res) => {
    try {
        const { matricula } = req.params;
        
        // Verificar que el estudiante existe
        const estudiante = memoryDB.estudiantes.find(e => e.matricula === matricula);
        if (!estudiante) {
            return res.status(404).json({ error: 'Estudiante no encontrado' });
        }
        
        // Obtener calificaciones del estudiante
        const calificaciones = memoryDB.calificaciones.filter(c => c.matricula === matricula);
        
        res.json({
            estudiante: {
                matricula: estudiante.matricula,
                nombre: estudiante.nombre_completo,
                grado: estudiante.grado,
                seccion: estudiante.seccion,
                activo: estudiante.activo
            },
            calificaciones: calificaciones,
            total_calificaciones: calificaciones.length
        });
        
    } catch (error) {
        logger.error('Error consultando calificaciones administrativas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
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

// Inicializar base de datos y servidor
initializeMemoryDB();

app.listen(PORT, () => {
    logger.info(`🚀 API SGE corriendo en puerto ${PORT}`);
    logger.info(`🌐 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`💾 Base de datos: Memoria`);
});

module.exports = app;
