const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require('path');
require("dotenv").config();
const fs = require("fs");
const recoveryService = require("./passwordRecoveryService");
const bookRoutes = require("./routes/bookRoutes");
const loanRoutes = require("./routes/loanRoutes");


const app = express();
const PORT = process.env.PORT || 5000;
const SECRET_KEY = process.env.JWT_SECRET || "CLAVE_SECRETA_POR_DEFECTO";


// --- Configuración de Conexión a MySQL ---
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
};

// --- Middlewares globales ---
app.use(cors());
app.use(bodyParser.json());

// --- Crear carpeta de subida si no existe y hacerla pública ---
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log(`✅ Directorio de carga '${uploadDir}' creado.`);
}
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// ==========================================================
// 🛡️ MIDDLEWARES DE SEGURIDAD
// ==========================================================

// 1. Autenticación (JWT)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.status(401).json({ message: "Token de autenticación requerido." });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            console.error("JWT Error:", err.message);
            return res.status(403).json({ message: "Token inválido o expirado." });
        }
        req.user = user; // user contiene { userId, rol }
        next();
    });
};

// 2. Autorización (Roles)
const authorizeRole = (allowedRoles) => (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.rol)) {
        return res.status(403).json({ message: "Acceso denegado. Permisos insuficientes." });
    }
    next();
};


// ==========================================================
// 🔐 RUTAS DE AUTENTICACIÓN
// ==========================================================
const authRouter = express.Router();

// Parámetros para bloqueo temporal
const COOLDOWN_TIME_MS = 5 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 3;

let dbPool; 


// 🚀 ENDPOINT: LOGIN
authRouter.post("/login", async (req, res) => {
    const { matricula, password } = req.body;

    try {
        const [rows] = await dbPool.query(
            "SELECT id_usuario, matricula, correo, contraseña, rol, intentos_fallidos, tiempo_bloqueo FROM usuarios WHERE matricula = ?",
            [matricula]
        );
        const user = rows[0];

        if (!user) {
            return res.status(401).json({ message: "Credenciales inválidas." });
        }

        // Verificar bloqueo temporal
        if (user.tiempo_bloqueo && new Date(user.tiempo_bloqueo) > new Date()) {
            const remainingTime = Math.ceil(
                (new Date(user.tiempo_bloqueo).getTime() - new Date().getTime()) / 1000
            );
            return res.status(403).json({
                message: `Su cuenta ha sido bloqueada temporalmente. Intente de nuevo en ${remainingTime} segundos.`,
            });
        }

        // Verificar contraseña
        const isMatch = await bcrypt.compare(password, user.contraseña);
        if (!isMatch) {
            const newAttempts = user.intentos_fallidos + 1;
            let bloqueoTime = null;
            let message = "Credenciales inválidas.";

            if (newAttempts >= MAX_FAILED_ATTEMPTS) {
                bloqueoTime = new Date(Date.now() + COOLDOWN_TIME_MS);
                const remainingTime = Math.ceil(COOLDOWN_TIME_MS / 1000);
                message = `Cuenta bloqueada temporalmente por ${MAX_FAILED_ATTEMPTS} intentos fallidos. Intente de nuevo en ${remainingTime} segundos.`;
            }

            await dbPool.query(
                "UPDATE usuarios SET intentos_fallidos = ?, tiempo_bloqueo = ? WHERE id_usuario = ?",
                [newAttempts, bloqueoTime, user.id_usuario]
            );

            return res.status(401).json({ message });
        }

        // Login exitoso → resetear intentos fallidos
        await dbPool.query(
            "UPDATE usuarios SET intentos_fallidos = 0, tiempo_bloqueo = NULL WHERE id_usuario = ?",
            [user.id_usuario]
        );

        // Crear token con el rol incluido
        const token = jwt.sign(
            { userId: user.id_usuario, rol: user.rol },
            SECRET_KEY,
            { expiresIn: "1h" }
        );
        
        // 💡 CORRECCIÓN: Devolver datos de usuario para el frontend
        const userData = {
            id_usuario: user.id_usuario,
            matricula: user.matricula,
            correo: user.correo,
            rol: user.rol,
            nombre: user.matricula // Si no tienes campo 'nombre', usa matrícula como fallback
        };

        res.status(200).json({ 
            token, 
            rol: user.rol,
            user: userData // Enviamos el objeto de usuario completo
        });

    } catch (error) {
        console.error("Error en login:", error);
        res.status(500).json({ message: "Error interno del servidor." });
    }
});

// 🚀 ENDPOINT: REGISTRO
authRouter.post("/register", async (req, res) => {
    const { matricula, correo, password } = req.body;
    
    if (!matricula || !correo || !password) {
        return res.status(400).json({ message: "Todos los campos son requeridos." });
    }

    try {
        const [existing] = await dbPool.query(
            "SELECT matricula FROM usuarios WHERE matricula = ?",
            [matricula]
        );

        if (existing.length > 0) {
            return res.status(409).json({ message: "La matrícula ya está registrada." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const defaultRole = "Estudiante";

        await dbPool.query(
            "INSERT INTO usuarios (matricula, correo, contraseña, rol, intentos_fallidos) VALUES (?, ?, ?, ?, 0)",
            [matricula, correo, hashedPassword, defaultRole]
        );

        res.status(201).json({ message: "Registro exitoso. Ya puede iniciar sesión." });
    } catch (error) {
        console.error("Error en registro:", error);
        res.status(500).json({ message: "Error interno del servidor." });
    }
});

// 🚀 ENDPOINT: RECUPERACIÓN DE CONTRASEÑA
authRouter.post("/forgot-password", async (req, res) => {
    const { recoveryInput } = req.body;
    
    try {
        if (!recoveryInput) {
            return res.status(400).json({ message: "Debe proporcionar correo o matrícula." });
        }

        const [users] = await dbPool.query(
            "SELECT id_usuario, correo FROM usuarios WHERE correo = ? OR matricula = ?",
            [recoveryInput, recoveryInput]
        );

        if (users.length === 0) {
            return res.status(200).json({
                message: "Si su cuenta existe, hemos enviado un correo con la contraseña temporal.",
            });
        }

        const tempPassword = recoveryService.generateTemporaryPassword();
        const userEmail = users[0].correo;

        await recoveryService.saveTemporaryPassword(dbPool, userEmail, tempPassword);
        const sent = await recoveryService.sendRecoveryEmail(userEmail, tempPassword);

        if (!sent) {
            return res.status(500).json({
                message: "No se pudo enviar el correo de recuperación. Revise la configuración SMTP.",
            });
        }

        res.status(200).json({
            message: "Contraseña temporal generada y enviada correctamente al correo (válida por 10 minutos).",
        });
    } catch (error) {
        console.error("Error en recuperación de contraseña:", error);
        res.status(500).json({ message: "Error interno del servidor." });
    }
});

app.use("/api/auth", authRouter);

// ==========================================================
// ⚙️ RUTAS DE ADMINISTRACIÓN
// ==========================================================
const adminRouter = express.Router();

// 🚀 ENDPOINT: LISTAR BIBLIOTECARIOS (GET)
// Solo accesible por un Administrador
adminRouter.get("/librarians", 
    authenticateToken, 
    authorizeRole(["Administrador"]), 
    async (req, res) => {
        try {
            // Se asume que el campo 'nombre' no existe en la tabla 'usuarios' y se usa 'matricula' 
            // como sustituto para el frontend, o que 'matricula' contiene el nombre completo.
            const [rows] = await dbPool.query(
                "SELECT id_usuario AS id, matricula, correo AS email FROM usuarios WHERE rol = 'Bibliotecario'"
            );

            // Mapeamos los resultados para que coincidan con la estructura del frontend: { id, nombre, email }
            const librarians = rows.map(row => ({
                id: row.id,
                nombre: row.matricula, // Usamos la matrícula como nombre para la vista
                email: row.email,
                matricula: row.matricula // Mantenemos la matrícula para futuras operaciones
            }));

            res.status(200).json(librarians);

        } catch (error) {
            console.error("Error al obtener bibliotecarios:", error);
            res.status(500).json({ message: "Error interno del servidor al obtener bibliotecarios." });
        }
});


// 🚀 ENDPOINT: AGREGAR BIBLIOTECARIO (POST)
adminRouter.post("/add-librarian", 
    authenticateToken, 
    authorizeRole(["Administrador"]),
    async (req, res) => {
        // En base a la estructura de tu modal se reciben 'nombre', 'correo', 'password'.
        const { matricula, nombre, correo, password } = req.body; 
        
        if (!matricula || !nombre || !correo || !password) {
            return res.status(400).json({ message: "Todos los campos (Matrícula, Nombre, Correo, Contraseña) son requeridos." });
        }

        try {
            // 1. Verificar si la matrícula o correo ya existen
            const [existing] = await dbPool.query(
                "SELECT matricula, correo FROM usuarios WHERE matricula = ? OR correo = ?",
                [matricula, correo]
            );

            if (existing.length > 0) {
                const isMatriculaDuplicate = existing.some(u => u.matricula === matricula);
                const isCorreoDuplicate = existing.some(u => u.correo === correo);

                if (isMatriculaDuplicate) {
                    return res.status(409).json({ message: `Error: La matrícula (${matricula}) ya está registrada.` });
                }
                if (isCorreoDuplicate) {
                    return res.status(409).json({ message: `Error: El correo (${correo}) ya está registrado.` });
                }
            }

            // 2. Hashear la contraseña
            const hashedPassword = await bcrypt.hash(password, 10);
            const librarianRole = "Bibliotecario";

            // 3. Insertar el nuevo Bibliotecario
            const [result] = await dbPool.query(
                "INSERT INTO usuarios (matricula, correo, contraseña, rol, intentos_fallidos) VALUES (?, ?, ?, ?, 0)",
                [matricula, correo, hashedPassword, librarianRole]
            );
            
            res.status(201).json({ 
                message: "Bibliotecario agregado exitosamente.", 
                userId: result.insertId,
                // Devolvemos los datos clave para que el frontend pueda actualizar la lista.
                librarian: {
                    id: result.insertId,
                    nombre,
                    email: correo, 
                    matricula
                }
            });

        } catch (error) {
            console.error("Error al agregar bibliotecario:", error);
            res.status(500).json({ message: "Error interno del servidor al agregar bibliotecario." });
        }
});

app.use("/api/admin", adminRouter);

// ==========================================================
// ⚙️ RUTAS DE PRÉSTAMOS (Integradas en adminRouter)
// ==========================================================

// 🚀 ENDPOINT 1: OBTENER HISTORIAL DE PRÉSTAMOS (GET)
adminRouter.get("/loan-history", 
    authenticateToken, 
    authorizeRole(["Administrador", "Bibliotecario"]),
    async (req, res) => {
        try {
            const query = `
                SELECT 
                    p.id_prestamo AS id, 
                    u.matricula AS usuario_matricula, 
                    l.titulo AS libro_titulo, 
                    p.fecha_prestamo, 
                    p.fecha_limite, 
                    p.fecha_devolucion, 
                    p.estado
                FROM prestamos p
                JOIN usuarios u ON p.usuario = u.id_usuario
                JOIN libros l ON p.libro = l.id_libro
                ORDER BY p.fecha_prestamo DESC;
            `;
            const [rows] = await dbPool.query(query);

            const history = rows.map(row => ({
                id: row.id,
                usuario: row.usuario_matricula, 
                matricula: row.usuario_matricula,
                libro: row.libro_titulo,
                fechaPrestamo: row.fecha_prestamo,
                fechaDevolucion: row.fecha_devolucion,
                // Mapear el estado de la DB ('activo'/'devuelto') a estatus del frontend
                estatus: row.estado === 'activo' ? 'Pendiente' : 'Devuelto',
            }));
            
            res.status(200).json(history);

        } catch (error) {
            console.error("Error al obtener historial de préstamos:", error);
            res.status(500).json({ message: "Error interno del servidor al obtener historial de préstamos." });
        }
});

// 🚀 ENDPOINT 2: MARCAR PRÉSTAMO COMO DEVUELTO (PUT)
adminRouter.put("/loan-return/:id_prestamo", 
    authenticateToken, 
    authorizeRole(["Administrador", "Bibliotecario"]),
    async (req, res) => {
        const { id_prestamo } = req.params;
        const fecha_devolucion = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD

        try {
            // 1. Actualizar el registro del préstamo a 'devuelto'
            const [updateResult] = await dbPool.query(
                "UPDATE prestamos SET estado = 'devuelto', fecha_devolucion = ? WHERE id_prestamo = ? AND estado = 'activo'",
                [fecha_devolucion, id_prestamo]
            );

            if (updateResult.affectedRows === 0) {
                return res.status(404).json({ message: "Préstamo no encontrado, ya estaba devuelto o no es un préstamo activo." });
            }
            
            // 2. Aumentar la cantidad de ejemplares disponibles del libro
            const [loan] = await dbPool.query("SELECT libro FROM prestamos WHERE id_prestamo = ?", [id_prestamo]);
            const libroId = loan[0].libro;
            
            // Incrementamos la cantidad de ejemplares en la tabla libros
            await dbPool.query("UPDATE libros SET ejemplares = ejemplares + 1 WHERE id_libro = ?", [libroId]);
            
            res.status(200).json({ 
                message: "Préstamo marcado como devuelto exitosamente. Ejemplar añadido al inventario.",
                fechaDevolucion: fecha_devolucion // Devolvemos la fecha real de devolución
            });

        } catch (error) {
            console.error(`Error al devolver préstamo ${id_prestamo}:`, error);
            res.status(500).json({ message: "Error interno del servidor al procesar la devolución." });
        }
});

// ==========================================================
// 📚 RUTAS DE PRÉSTAMOS
// ==========================================================
const loanRouter = express.Router();

// 🚀 ENDPOINT: CREAR PRÉSTAMO
// ✅ CORREGIDO para estudiantes según estructura real de BD
loanRouter.post("/create", 
    authenticateToken, 
    async (req, res) => {
    
    const { matricula, bookId, dueDate } = req.body; 

    console.log("📥 Solicitud de préstamo recibida:", { matricula, bookId, dueDate });
    console.log("👤 Usuario autenticado:", req.user);

    if (!matricula || !bookId || !dueDate) {
        return res.status(400).json({ message: "Datos de préstamo incompletos (matrícula, ID de libro, fecha límite)." });
    }

    try {
        // --- 1. Obtener ID de Usuario a partir de la Matrícula ---
        const [userRows] = await dbPool.query(
            "SELECT id_usuario, rol FROM usuarios WHERE matricula = ?",
            [matricula]
        );
        const user = userRows[0];
        
        if (!user) {
            console.error("❌ Usuario no encontrado con matrícula:", matricula);
            return res.status(404).json({ message: "Error: No se encontró un usuario con esa matrícula." });
        }
        
        const userId = user.id_usuario;
        console.log("✅ Usuario encontrado - ID:", userId);

        // --- 2. SEGURIDAD: Verificar que el usuario solo pueda crear préstamos para sí mismo ---
        if (req.user.rol === 'Estudiante' && req.user.userId !== userId) {
            console.error("🚫 Intento de préstamo no autorizado");
            return res.status(403).json({ 
                message: "Error: Los estudiantes solo pueden crear préstamos para sí mismos." 
            });
        }

        // --- 3. Verificar disponibilidad y tipo del Libro ---
        const [bookRows] = await dbPool.query(
            "SELECT id_libro, titulo, tipo, ejemplares FROM libros WHERE id_libro = ?",
            [bookId]
        );
        const book = bookRows[0];

        if (!book) {
            console.error("❌ Libro no encontrado - ID:", bookId);
            return res.status(404).json({ message: "Error: Libro no encontrado." });
        }

        console.log("📚 Libro encontrado:", book.titulo, "- Ejemplares:", book.ejemplares);

        if (book.tipo === 'digital') {
            console.error("❌ Intento de préstamo de libro digital");
            return res.status(400).json({ message: "Error: El préstamo físico no aplica para libros digitales." });
        }

        if (book.ejemplares <= 0) {
            console.error("❌ No hay ejemplares disponibles");
            return res.status(400).json({ message: "Error: No hay ejemplares disponibles de este libro para préstamo." });
        }
        
        // --- 4. Verificar que el usuario no tenga préstamos activos del mismo libro ---
        const [activeLoans] = await dbPool.query(
            "SELECT id_prestamo FROM prestamos WHERE usuario = ? AND libro = ? AND estado = 'activo'",
            [userId, bookId]
        );

        if (activeLoans.length > 0) {
            console.error("❌ Préstamo duplicado detectado");
            return res.status(400).json({ 
                message: "Error: Ya tienes un préstamo activo de este libro." 
            });
        }

        // --- 5. Crear el Préstamo (Transacción) ---
        const connection = await dbPool.getConnection();
        try {
            await connection.beginTransaction();
            console.log("🔄 Iniciando transacción de préstamo...");

            // ✅ IMPORTANTE: fecha_prestamo es VARCHAR en tu BD, usamos formato de fecha como string
            const fechaPrestamoStr = new Date().toISOString().split('T')[0]; // Formato: YYYY-MM-DD

            // a) Insertar el nuevo préstamo
            const [result] = await connection.query(
                `INSERT INTO prestamos (fecha_prestamo, fecha_limite, estado, renovacion, usuario, libro) 
                 VALUES (?, ?, 'activo', 0, ?, ?)`,
                [fechaPrestamoStr, dueDate, userId, bookId]
            );
            
            console.log("✅ Préstamo insertado - ID:", result.insertId);

            // b) Decrementar los ejemplares disponibles
            await connection.query(
                "UPDATE libros SET ejemplares = ejemplares - 1 WHERE id_libro = ?",
                [bookId]
            );

            console.log("✅ Ejemplares actualizados");

            await connection.commit();
            connection.release();
            
            console.log("🎉 Transacción completada exitosamente");
            
            res.status(201).json({ 
                success: true,
                message: "Préstamo registrado exitosamente.", 
                loanId: result.insertId 
            });

        } catch (transactionError) {
            await connection.rollback();
            connection.release();
            console.error("❌ Error en transacción de préstamo:", transactionError);
            res.status(500).json({ message: "Error al registrar el préstamo. Inténtalo de nuevo." });
        }

    } catch (error) {
        console.error("❌ Error en el endpoint /api/loans/create:", error);
        res.status(500).json({ message: "Error interno del servidor." });
    }
});

// Conectar rutas de préstamos
app.use("/api/loans", loanRouter);
// ==========================================================
// 🚀 CONEXIÓN A MYSQL Y ARRANQUE DEL SERVIDOR
// ==========================================================
async function connectToDb() {
    try {
        dbPool = await mysql.createPool(dbConfig);
        console.log(`✅ Conexión a MySQL (${process.env.DB_NAME}) exitosa.`);

        // Inicializamos las rutas de libros ahora que dbPool existe
        app.use("/api/books", bookRoutes(dbPool));

        // Arrancar servidor
        app.listen(PORT, () => {
            console.log(`\n✅ Backend corriendo en: http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error("❌ Error al conectar a la base de datos:", err.message);
        process.exit(1);
    }
}

connectToDb();