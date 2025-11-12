// routes/loanRoutes.js
const express = require("express");

module.exports = function loanRoutes(dbPool, authenticateToken) {
    const router = express.Router();

    // crear préstamo
    router.post("/create", authenticateToken, async (req, res) => {
        const { matricula, bookId, dueDate } = req.body;

        console.log("📥 Solicitud de préstamo recibida:", { matricula, bookId, dueDate });
        console.log("👤 Usuario autenticado:", req.user);

        if (!matricula || !bookId || !dueDate) {
            return res.status(400).json({ message: "Datos incompletos (matrícula, libro, fecha límite)." });
        }

        try {
            // buscar usuario por matrícula
            const [userRows] = await dbPool.query(
                "SELECT id_usuario, rol FROM usuarios WHERE matricula = ?",
                [matricula]
            );
            const user = userRows[0];
            if (!user) return res.status(404).json({ message: "Usuario no encontrado." });

            const userId = user.id_usuario;

            // validar que el estudiante solo cree sus propios préstamos
            if (req.user.rol === "Estudiante" && req.user.userId !== userId) {
                return res.status(403).json({
                    message: "Los estudiantes solo pueden crear préstamos para sí mismos.",
                });
            }

            // obtener libro
            const [bookRows] = await dbPool.query(
                "SELECT id_libro, titulo, tipo, ejemplares FROM libros WHERE id_libro = ?",
                [bookId]
            );
            const book = bookRows[0];
            if (!book) return res.status(404).json({ message: "Libro no encontrado." });

            if (book.tipo === "digital") {
                return res.status(400).json({ message: "Los libros digitales no se prestan físicamente." });
            }

            if (book.ejemplares <= 0) {
                return res.status(400).json({ message: "No hay ejemplares disponibles." });
            }

            // verificar si el usuario ya tiene un préstamo activo del mismo libro
            const [activeLoans] = await dbPool.query(
                "SELECT id_prestamo FROM prestamos WHERE usuario = ? AND libro = ? AND estado = 'activo'",
                [userId, bookId]
            );
            if (activeLoans.length > 0) {
                return res.status(400).json({ message: "Ya tienes un préstamo activo de este libro." });
            }

            // crear préstamo dentro de una transacción
            const connection = await dbPool.getConnection();
            try {
                await connection.beginTransaction();

                const fechaPrestamoStr = new Date().toISOString().split("T")[0];

                const [result] = await connection.query(
                    `INSERT INTO prestamos (fecha_prestamo, fecha_limite, estado, renovacion, usuario, libro)
                     VALUES (?, ?, 'activo', 0, ?, ?)`,
                    [fechaPrestamoStr, dueDate, userId, bookId]
                );

                await connection.query(
                    "UPDATE libros SET ejemplares = ejemplares - 1 WHERE id_libro = ?",
                    [bookId]
                );

                await connection.commit();
                connection.release();

                res.status(201).json({
                    success: true,
                    message: "Préstamo registrado exitosamente.",
                    loanId: result.insertId,
                });
            } catch (txErr) {
                await connection.rollback();
                connection.release();
                console.error("❌ Error en transacción:", txErr);
                res.status(500).json({ message: "Error al registrar el préstamo." });
            }
        } catch (err) {
            console.error("❌ Error en /api/loans/create:", err);
            res.status(500).json({ message: "Error interno del servidor." });
        }
    });

    return router;
};
