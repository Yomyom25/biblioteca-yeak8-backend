// routes/bookRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configuración de Multer con validaciones
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = "uploads/";
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + "-" + file.originalname);
    },
});

// Filtro de archivos
const fileFilter = (req, file, cb) => {
    if (file.fieldname === "pdfFiles") {
        if (file.mimetype === "application/pdf") {
            cb(null, true);
        } else {
            cb(new Error("Solo se permiten archivos PDF"), false);
        }
    } else if (file.fieldname === "coverImage") {
        const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Solo se permiten imágenes (JPG, PNG, WEBP)"), false);
        }
    } else {
        cb(null, true);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB por archivo
    },
});

// Función para eliminar archivos en caso de error
const deleteUploadedFiles = (files) => {
    if (!files) return;
    Object.keys(files).forEach((fieldname) => {
        files[fieldname].forEach((file) => {
            if (fs.existsSync(file.path)) {
                try {
                    fs.unlinkSync(file.path);
                } catch (e) {
                    console.error("Error eliminando archivo:", e);
                }
            }
        });
    });
};

// Exportamos una función que recibe dbPool
module.exports = (dbPool) => {
    // ---------------------------
    // GET / -> obtener todos los libros
    // ---------------------------
    router.get("/", async (req, res) => {
        try {
            // Seleccionamos campos importantes y devolvemos el año separado
            const [rows] = await dbPool.query(`
        SELECT 
          id_libro AS id,
          titulo,
          autor,
          categoria,
          tipo,
          ejemplares,
          estatus,
          link_archivo,
          link_imagen,
          YEAR(fecha_publicacion) AS ano
        FROM libros
        ORDER BY titulo ASC
      `);

            // Transformamos para que el frontend tenga una URL completa de la imagen si existe
            const host = req.protocol + "://" + req.get("host");
            const data = rows.map((r) => ({
                id: r.id,
                titulo: r.titulo,
                autor: r.autor,
                categoria: r.categoria,
                tipo: r.tipo,
                ejemplares: r.ejemplares,
                estatus: r.estatus
                    ? r.estatus
                    : r.ejemplares > 0
                        ? "Disponible"
                        : "No Disponible",
                link_archivo: r.link_archivo, // puede ser null o lista de paths
                imagen: r.link_imagen
                    ? `${host}/${r.link_imagen.replace(/^\/+/, "")}`
                    : null,
                ano: r.ano || "N/A",
            }));

            res.json(data);
        } catch (error) {
            console.error("Error al obtener los libros:", error);
            res.status(500).json({ message: "Error al obtener los libros" });
        }
    });

    // ---------------------------
    // POST /register -> registrar libro (tu lógica ya existente)
    // ---------------------------
    router.post(
        "/register",
        upload.fields([
            { name: "pdfFiles", maxCount: 5 },
            { name: "coverImage", maxCount: 1 },
        ]),
        async (req, res) => {
            console.log("\n========================================");
            console.log("📥 DATOS RECIBIDOS EN EL SERVIDOR");
            console.log("========================================");
            console.log("📦 req.body completo:", req.body);
            console.log("📦 req.files:", req.files);
            console.log("========================================\n");

            try {
                let { titulo, autor, categoria, ano, tipo, ejemplares } = req.body;
                const pdfFiles = req.files?.pdfFiles || [];
                const coverImage = req.files?.coverImage
                    ? req.files.coverImage[0]
                    : null;

                console.log("📋 Datos extraídos:", {
                    titulo,
                    autor,
                    categoria,
                    ano,
                    tipo,
                    ejemplares,
                });

                // Validaciones (igual que tenías)
                if (!titulo || !titulo.trim()) {
                    deleteUploadedFiles(req.files);
                    return res.status(400).json({ message: "El título es obligatorio." });
                }
                if (!autor || !autor.trim()) {
                    deleteUploadedFiles(req.files);
                    return res.status(400).json({ message: "El autor es obligatorio." });
                }
                if (!categoria || !categoria.trim()) {
                    deleteUploadedFiles(req.files);
                    return res
                        .status(400)
                        .json({ message: "La categoría es obligatoria." });
                }
                if (!tipo || !["fisico", "digital"].includes(tipo)) {
                    deleteUploadedFiles(req.files);
                    return res
                        .status(400)
                        .json({ message: "El tipo debe ser 'fisico' o 'digital'." });
                }

                const currentYear = new Date().getFullYear();
                const year = parseInt(ano);
                if (!ano || isNaN(year)) {
                    deleteUploadedFiles(req.files);
                    return res
                        .status(400)
                        .json({
                            message:
                                "El año de publicación es obligatorio y debe ser un número.",
                        });
                }
                if (year < 1000) {
                    deleteUploadedFiles(req.files);
                    return res
                        .status(400)
                        .json({ message: "El año de publicación debe ser mayor a 1000." });
                }
                if (year > currentYear) {
                    deleteUploadedFiles(req.files);
                    return res
                        .status(400)
                        .json({
                            message: `El año de publicación no puede ser mayor al año actual (${currentYear}).`,
                        });
                }

                ejemplares = parseInt(ejemplares, 10);
                if (tipo === "digital") {
                    ejemplares = 0;
                } else {
                    if (isNaN(ejemplares) || ejemplares < 1) {
                        deleteUploadedFiles(req.files);
                        return res
                            .status(400)
                            .json({
                                message: "Los libros físicos deben tener al menos 1 ejemplar.",
                            });
                    }
                    if (ejemplares > 9999) {
                        deleteUploadedFiles(req.files);
                        return res
                            .status(400)
                            .json({
                                message: "El número de ejemplares no puede exceder 9999.",
                            });
                    }
                }

                if (tipo === "digital" && pdfFiles.length === 0) {
                    deleteUploadedFiles(req.files);
                    return res
                        .status(400)
                        .json({
                            message:
                                "Los libros digitales requieren al menos un archivo PDF.",
                        });
                }

                // Validación de duplicados
                const [existing] = await dbPool.query(
                    "SELECT id_libro FROM libros WHERE titulo = ? AND autor = ?",
                    [titulo.trim(), autor.trim()]
                );

                if (existing.length > 0) {
                    deleteUploadedFiles(req.files);
                    return res
                        .status(409)
                        .json({
                            message: "Ya existe un libro con el mismo título y autor.",
                        });
                }

                // Preparar links
                const linkArchivos =
                    pdfFiles.length > 0
                        ? pdfFiles.map((file) => file.path).join(",")
                        : null;
                const linkImagen = coverImage ? coverImage.path : null;

                const tituloClean = titulo.trim();
                const autorClean = autor.trim();
                const categoriaClean = categoria.trim();
                const fechaPublicacion = year;

                const query = `
        INSERT INTO libros 
        (titulo, autor, categoria, fecha_publicacion, estatus, link_archivo, link_imagen, tipo, ejemplares) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

                const [result] = await dbPool.query(query, [
                    tituloClean,
                    autorClean,
                    categoriaClean,
                    fechaPublicacion,
                    "disponible",
                    linkArchivos,
                    linkImagen,
                    tipo,
                    ejemplares,
                ]);

                console.log("✅ Libro registrado exitosamente. ID:", result.insertId);
                res.status(201).json({
                    message: "Libro registrado exitosamente",
                    id_libro: result.insertId,
                    datos: {
                        titulo: tituloClean,
                        autor: autorClean,
                        tipo: tipo,
                        ejemplares: ejemplares,
                        año: year,
                    },
                });
            } catch (error) {
                console.error("\n❌❌❌ ERROR EN EL SERVIDOR ❌❌❌");
                console.error("Error completo:", error);
                console.error("Stack:", error.stack);
                console.error("========================================\n");

                deleteUploadedFiles(req.files);

                if (error instanceof multer.MulterError) {
                    if (error.code === "LIMIT_FILE_SIZE") {
                        return res
                            .status(400)
                            .json({
                                message: "El archivo excede el tamaño máximo permitido (10MB).",
                            });
                    }
                    return res
                        .status(400)
                        .json({ message: `Error al subir archivo: ${error.message}` });
                }

                if (error.message && error.message.includes("Solo se permiten")) {
                    return res.status(400).json({ message: error.message });
                }

                if (error.code === "ER_NO_SUCH_TABLE") {
                    return res
                        .status(500)
                        .json({
                            message:
                                "Error de configuración de base de datos. Contacte al administrador.",
                        });
                }

                if (error.code === "ER_BAD_FIELD_ERROR") {
                    return res
                        .status(500)
                        .json({
                            message:
                                "Error de configuración de base de datos (campo faltante). Contacte al administrador.",
                        });
                }

                res
                    .status(500)
                    .json({
                        message: "Error interno del servidor al registrar el libro.",
                    });
            }
        }
    );



    return router;
};
