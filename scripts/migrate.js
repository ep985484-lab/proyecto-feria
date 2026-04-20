/**
 * Script de Migración - Sistema de Gestión Escolar (SGE)
 * Migra datos del sistema actual a la nueva API centralizada
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;

const DB_PATH = path.join(__dirname, '..', 'data', 'sge.db');
const LEGACY_DB_PATH = path.join(__dirname, '..', '..', 'systemDataManager.js');

// Crear directorio de datos si no existe
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdir(dataDir, { recursive: true });
}

// Conexión a la nueva base de datos
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error conectando a la base de datos:', err);
        process.exit(1);
    }
    console.log('✅ Conectado a la base de datos de migración');
});

// Función para leer datos del sistema actual
async function readLegacyData() {
    console.log('📖 Leyendo datos del sistema actual...');
    
    try {
        // Intentar leer systemDataManager.js
        if (fs.existsSync(LEGACY_DB_PATH)) {
            const content = await fs.readFile(LEGACY_DB_PATH, 'utf8');
            
            // Extraer datos del archivo JavaScript
            const dataMatch = content.match(/const initialData = ({[\s\S]*?});/);
            if (dataMatch) {
                const dataString = dataMatch[0].replace('const initialData = ', '');
                return eval(`(${dataString})`);
            }
        }
        
        // Fallback: leer datos de localStorage simulado
        console.log('⚠️ No se encontró systemDataManager.js, usando datos de ejemplo');
        return getExampleData();
        
    } catch (error) {
        console.error('❌ Error leyendo datos heredados:', error);
        return getExampleData();
    }
}

// Datos de ejemplo para migración inicial
function getExampleData() {
    return {
        usuarios: [
            { username: 'admin', name: 'Administrador Principal', role: 'administrador' },
            { username: 'admin2', name: 'Administrador Secundario', role: 'administrador' },
            { username: 'admin3', name: 'Administrador Terciario', role: 'administrador' },
            { username: 'direccion', name: 'Director General', role: 'direccion' },
            { username: 'prof_starling', name: 'Prof. Starling Batista', role: 'docente' },
            { username: 'prof_belkis', name: 'Prof. Belkis Martínez', role: 'docente' },
            { username: 'psi_maria', name: 'María Gómez', role: 'psicologa' },
            { username: 'psi_ana', name: 'Ana Martínez', role: 'psicologa' },
            { username: 'psi_laura', name: 'Laura Pérez', role: 'psicologa' }
        ],
        excusas: [
            {
                studentName: 'Juan Pérez',
                course: '1er Año',
                psychologistUsername: 'psi_maria',
                reason: 'Estudiante con fiebre',
                type: 'medica',
                professorUsername: 'prof_starling',
                status: 'pending'
            },
            {
                studentName: 'María González',
                course: '2do Año',
                psychologistUsername: 'psi_ana',
                reason: 'Estudiante con cita médica',
                type: 'medica',
                professorUsername: 'prof_belkis',
                status: 'approved'
            }
        ],
        mensajes: [
            {
                sender: 'prof_starling',
                recipient: 'psi_maria',
                subject: 'Seguimiento de estudiante',
                content: 'Necesito seguimiento para Juan Pérez...',
                status: 'sent'
            },
            {
                sender: 'psi_maria',
                recipient: 'prof_starling',
                subject: 'Re: Seguimiento de estudiante',
                content: 'He revisado el caso de Juan Pérez...',
                status: 'sent'
            }
        ],
        asistencia: [
            {
                course: '1er Año',
                date: '2024-03-10',
                presentStudents: ['Juan Pérez', 'María González', 'Pedro López'],
                absentStudents: ['Ana Rodríguez'],
                totalStudents: 25,
                professorUsername: 'prof_starling'
            }
        ]
    };
}

// Función para hashear contraseñas
function hashPassword(password) {
    const bcrypt = require('bcryptjs');
    return bcrypt.hashSync(password, 10);
}

// Función principal de migración
async function migrate() {
    console.log('🚀 Iniciando migración de datos...');
    
    try {
        // Leer datos heredados
        const legacyData = await readLegacyData();
        
        console.log(`📊 Datos encontrados:`);
        console.log(`   - Usuarios: ${legacyData.usuarios?.length || 0}`);
        console.log(`   - Excusas: ${legacyData.excusas?.length || 0}`);
        console.log(`   - Mensajes: ${legacyData.mensajes?.length || 0}`);
        console.log(`   - Asistencia: ${legacyData.asistencia?.length || 0}`);
        
        // Migrar usuarios
        if (legacyData.usuarios && legacyData.usuarios.length > 0) {
            console.log('👥 Migrando usuarios...');
            
            for (const user of legacyData.usuarios) {
                await new Promise((resolve, reject) => {
                    const hashedPassword = hashPassword('password123'); // Contraseña por defecto
                    db.run(
                        'INSERT OR REPLACE INTO users (username, password, name, role) VALUES (?, ?, ?, ?)',
                        [user.username, hashedPassword, user.name, user.role],
                        function(err) {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
            }
            
            console.log(`✅ ${legacyData.usuarios.length} usuarios migrados`);
        }
        
        // Migrar excusas
        if (legacyData.excusas && legacyData.excusas.length > 0) {
            console.log('📝 Migrando excusas...');
            
            for (const excuse of legacyData.excusas) {
                await new Promise((resolve, reject) => {
                    db.run(
                        'INSERT INTO excuses (studentName, course, psychologistUsername, reason, type, professorUsername, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [excuse.studentName, excuse.course, excuse.psychologistUsername, excuse.reason, excuse.type, excuse.professorUsername, excuse.status],
                        function(err) {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
            }
            
            console.log(`✅ ${legacyData.excusas.length} excusas migradas`);
        }
        
        // Migrar mensajes
        if (legacyData.mensajes && legacyData.mensajes.length > 0) {
            console.log('📧 Migrando mensajes...');
            
            for (const message of legacyData.mensajes) {
                await new Promise((resolve, reject) => {
                    db.run(
                        'INSERT INTO messages (sender, recipient, subject, content, status, readStatus) VALUES (?, ?, ?, ?, ?, ?)',
                        [message.sender, message.recipient, message.subject, message.content, message.status, 0],
                        function(err) {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
            }
            
            console.log(`✅ ${legacyData.mensajes.length} mensajes migrados`);
        }
        
        // Migrar asistencia
        if (legacyData.asistencia && legacyData.asistencia.length > 0) {
            console.log('📊 Migrando asistencia...');
            
            for (const attendance of legacyData.asistencia) {
                await new Promise((resolve, reject) => {
                    db.run(
                        'INSERT INTO attendance (course, date, presentStudents, absentStudents, totalStudents, professorUsername) VALUES (?, ?, ?, ?, ?, ?)',
                        [attendance.course, attendance.date, JSON.stringify(attendance.presentStudents), JSON.stringify(attendance.absentStudents), attendance.totalStudents, attendance.professorUsername],
                        function(err) {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
            }
            
            console.log(`✅ ${legacyData.asistencia.length} registros de asistencia migrados`);
        }
        
        // Verificar migración
        db.all('SELECT COUNT(*) as users FROM users', [], (err, result) => {
            if (err) {
                console.error('❌ Error verificando migración:', err);
                return;
            }
            
            console.log('\n🎉 MIGRACIÓN COMPLETADA');
            console.log('📊 Estadísticas finales:');
            console.log(`   - Usuarios migrados: ${result[0].users}`);
            
            db.all('SELECT COUNT(*) as excuses FROM excuses', [], (err, result) => {
                console.log(`   - Excusas migradas: ${result[0].excuses}`);
                
                db.all('SELECT COUNT(*) as messages FROM messages', [], (err, result) => {
                    console.log(`   - Mensajes migrados: ${result[0].messages}`);
                    
                    db.all('SELECT COUNT(*) as attendance FROM attendance', [], (err, result) => {
                        console.log(`   - Asistencia migrada: ${result[0].attendance}`);
                        console.log('\n✅ Base de datos lista para uso con la nueva API');
                        
                        // Cerrar conexión
                        db.close((err) => {
                            if (err) {
                                console.error('❌ Error cerrando base de datos:', err);
                            } else {
                                console.log('📁 Base de datos cerrada correctamente');
                            }
                        });
                    });
                });
            });
        });
        
    } catch (error) {
        console.error('❌ Error durante la migración:', error);
        process.exit(1);
    }
}

// Ejutar migración
if (require.main === module) {
    migrate();
}

module.exports = { migrate, readLegacyData };
