import mammoth from "mammoth";
async function attachmentsToContent(files = []) {
    return await Promise.all(files.map(async (f) => {
        let base64Data = f.content || "";

        if (base64Data.startsWith("data:")) {
            const commaIndex = base64Data.indexOf(",");
            base64Data = base64Data.slice(commaIndex + 1);
        }

        // ✅ Handle different MIME types
        if (f.type.startsWith("image/")) {
            return {
                type: "image",
                source_type: "base64",
                data: base64Data,
                mime_type: f.type,
            };
        }

        if (f.type === "application/pdf") {
            return {
                type: "file",
                source_type: "base64",
                data: base64Data,
                mime_type: f.type,
            };
        }

        if (f.type.startsWith("text/") || f.type === "application/json") {
            return {
                type: "text",
                text: f.content, // already plain text from frontend
            };
        }

        if (
            f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
            f.type === "application/msword"
        ) {

            try {
                const text = await mammoth.extractRawText({ buffer: Buffer.from(base64Data, "base64") });
                return {
                    type: "text",
                    text: text.value,
                };

            } catch (error) {
                return {
                    type: "text",
                    text: `Error extracting text from DOCX: ${error.message}`,
                };
            }
        }

        if (
            f.type.startsWith("application/vnd.ms-excel") ||
            f.type.startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml")
        ) {
            try {
                const buffer = Buffer.from(base64Data, "base64");
                const workbook = XLSX.read(buffer, { type: "buffer" });

                let extractedText = "";
                workbook.SheetNames.forEach(sheetName => {
                    const sheet = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
                    extractedText += `\n--- Sheet: ${sheetName} ---\n${sheet}`;
                });

                return { type: "text", text: extractedText };
            } catch (error) {
                return { type: "text", text: `Error extracting Excel file: ${error.message}` };
            }
        }

        // ✅ Handle PowerPoint files
        if (
            f.type.startsWith("application/vnd.ms-powerpoint") ||
            f.type.startsWith("application/vnd.openxmlformats-officedocument.presentationml")
        ) {
            try {
                const buffer = Buffer.from(base64Data, "base64");
                const slides = await extractPptx(buffer);

                let extractedText = slides.map((s, i) => `--- Slide ${i + 1} ---\n${s.text}`).join("\n\n");

                return { type: "text", text: extractedText };
            } catch (error) {
                return { type: "text", text: `Error extracting PowerPoint file: ${error.message}` };
            }
        }

        // Default fallback (doc/docx etc → still base64)
        return {
            type: "file",
            source_type: "base64",
            data: base64Data,
            mime_type: f.type,
        };
    }));
}

export {
    attachmentsToContent,
};

